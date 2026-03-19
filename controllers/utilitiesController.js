const asyncHandler = require("express-async-handler");
const fs = require("fs/promises");
const path = require("path");
const { createDatabaseBackup, deleteBackup, listBackups } = require("../services/backupService");

const mediaRoots = {
  uploads: path.join(__dirname, "..", "uploads"),
  public: path.join(__dirname, "..", "..", "crm", "public"),
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
};

const ensureInsideRoot = (rootPath, targetPath) => {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
};

const listMediaRoots = asyncHandler(async (_req, res) => {
  const roots = await Promise.all(
    Object.entries(mediaRoots).map(async ([key, rootPath]) => {
      await fs.mkdir(rootPath, { recursive: true });
      const entries = await fs.readdir(rootPath, { withFileTypes: true });
      return {
        key,
        label: key === "uploads" ? "media" : "public",
        itemCount: entries.length,
      };
    })
  );

  res.json({ success: true, data: roots });
});

const browseMedia = asyncHandler(async (req, res) => {
  const rootKey = req.query.root || "uploads";
  const relativePath = String(req.query.path || "");
  const rootPath = mediaRoots[rootKey];

  if (!rootPath) {
    return res.status(400).json({ message: "Invalid media root" });
  }

  await fs.mkdir(rootPath, { recursive: true });
  const targetPath = path.join(rootPath, relativePath);
  if (!ensureInsideRoot(rootPath, targetPath)) {
    return res.status(400).json({ message: "Invalid media path" });
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const items = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(targetPath, entry.name);
      const stats = await fs.stat(fullPath);
      const childRelativePath = path.relative(rootPath, fullPath).replace(/\\/g, "/");
      return {
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
        relativePath: childRelativePath,
        size: entry.isDirectory() ? null : stats.size,
        formattedSize: entry.isDirectory() ? "-" : formatBytes(stats.size),
        modifiedAt: stats.mtime,
        downloadUrl:
          entry.isDirectory()
            ? null
            : rootKey === "uploads"
              ? `/uploads/${childRelativePath}`
              : null,
      };
    })
  );

  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  res.json({
    success: true,
    data: {
      root: rootKey,
      currentPath: relativePath.replace(/\\/g, "/"),
      items,
    },
  });
});

const getBackups = asyncHandler(async (_req, res) => {
  const backups = await listBackups();
  res.json({
    success: true,
    data: backups.map((backup) => ({
      ...backup,
      formattedSize: formatBytes(backup.size),
      downloadUrl: `/backups/${backup.fileName}`,
    })),
  });
});

const createBackup = asyncHandler(async (_req, res) => {
  const backup = await createDatabaseBackup();
  res.status(201).json({
    success: true,
    data: {
      ...backup,
      formattedSize: formatBytes(backup.size),
      downloadUrl: `/backups/${backup.fileName}`,
    },
  });
});

const removeBackup = asyncHandler(async (req, res) => {
  await deleteBackup(req.params.fileName);
  res.json({ success: true, message: "Backup deleted successfully" });
});

module.exports = {
  listMediaRoots,
  browseMedia,
  getBackups,
  createBackup,
  removeBackup,
};

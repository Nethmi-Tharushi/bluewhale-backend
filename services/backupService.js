const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const mongoose = require("mongoose");

const backupsDir = path.join(__dirname, "..", "backups");
const tempDir = path.join(backupsDir, "_tmp");

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const sanitizeSegment = (value) => String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_");

const replacer = (_key, value) => {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    if (value._bsontype === "ObjectId") return value.toString();
    if (value._bsontype === "Decimal128") return value.toString();
    if (value._bsontype === "Binary" && value.buffer) return Buffer.from(value.buffer).toString("base64");
    if (Buffer.isBuffer(value)) return value.toString("base64");
  }
  return value;
};

const runPowerShell = (command) =>
  new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      windowsHide: true,
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `PowerShell exited with code ${code}`));
    });
  });

const createDatabaseBackup = async () => {
  await ensureDir(backupsDir);
  await ensureDir(tempDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `database_backup_${timestamp}.zip`;
  const tempDumpDir = path.join(tempDir, timestamp);

  await ensureDir(tempDumpDir);

  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database connection is not ready");
    }

    const collections = await db.listCollections().toArray();
    const manifest = [];

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const safeName = sanitizeSegment(collectionName);
      const filePath = path.join(tempDumpDir, `${safeName}.json`);
      const docs = await db.collection(collectionName).find({}).toArray();
      await fs.writeFile(filePath, JSON.stringify(docs, replacer, 2), "utf8");
      manifest.push({
        collection: collectionName,
        documentCount: docs.length,
        file: `${safeName}.json`,
      });
    }

    await fs.writeFile(
      path.join(tempDumpDir, "manifest.json"),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          databaseName: db.databaseName,
          collectionCount: collections.length,
          collections: manifest,
        },
        null,
        2
      ),
      "utf8"
    );

    const zipPath = path.join(backupsDir, baseName);
    const escapedSource = tempDumpDir.replace(/'/g, "''");
    const escapedTarget = zipPath.replace(/'/g, "''");
    await runPowerShell(`Compress-Archive -Path '${escapedSource}\\*' -DestinationPath '${escapedTarget}' -Force`);

    const stats = await fs.stat(zipPath);
    return {
      fileName: baseName,
      filePath: zipPath,
      size: stats.size,
      createdAt: stats.birthtime || stats.mtime,
    };
  } finally {
    await fs.rm(tempDumpDir, { recursive: true, force: true });
  }
};

const listBackups = async () => {
  await ensureDir(backupsDir);
  const entries = await fs.readdir(backupsDir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"))
      .map(async (entry) => {
        const filePath = path.join(backupsDir, entry.name);
        const stats = await fs.stat(filePath);
        return {
          fileName: entry.name,
          size: stats.size,
          createdAt: stats.birthtime || stats.mtime,
        };
      })
  );

  return files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

const deleteBackup = async (fileName) => {
  const safeName = path.basename(fileName || "");
  if (!safeName.toLowerCase().endsWith(".zip")) {
    throw new Error("Invalid backup file");
  }
  await fs.rm(path.join(backupsDir, safeName), { force: true });
};

module.exports = {
  backupsDir,
  createDatabaseBackup,
  listBackups,
  deleteBackup,
};

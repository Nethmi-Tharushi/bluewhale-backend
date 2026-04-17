// server.js
const path = require("path");
const dotenv = require("dotenv");

// load correct .env file based on environment
if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: path.resolve(__dirname, ".env.production") });
  console.log("Using production environment variables");
} else {
  dotenv.config({ path: path.resolve(__dirname, ".env") });
  console.log("Using local development environment variables");
}

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const colors = require("colors");
const http = require("http");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
require("./jobs/meetingReminderJob");
const { startWhatsAppAutomationWorker } = require("./services/whatsappAutomationService");
const { startWhatsAppCampaignWorker } = require("./services/whatsappCampaignRuntimeService");

const Message = require("./models/Message");
const User = require("./models/User");
const AdminUser = require("./models/AdminUser");
// const ChatUser = require("./models/ChatUser");
// const ChatAssignment = require("./models/ChatAssignment");

const app = express();
const server = http.createServer(app);

const isNgrokOrigin = (origin = "") =>
  /\.ngrok-free\.app$/i.test(origin) ||
  /\.ngrok\.io$/i.test(origin) ||
  /\.ngrok\.app$/i.test(origin);

const isAllowedOrigin = (origin = "") => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    return isNgrokOrigin(hostname);
  } catch {
    return false;
  }
};

const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:4173",
  "http://localhost:4174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:4174",
  "http://31.220.91.65",
  "http://31.220.91.65:5173",
  "http://31.220.91.65:5174",
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

const isLocalDevRequest = (req) => {
  const origin = String(req.headers.origin || "");
  const host = String(req.headers.host || "");
  const forwardedFor = String(req.headers["x-forwarded-for"] || "");
  const ip = String(req.ip || "");

  return (
    origin.includes("localhost") ||
    origin.includes("127.0.0.1") ||
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    forwardedFor.includes("127.0.0.1") ||
    ip.includes("127.0.0.1") ||
    ip.includes("::1")
  );
};

const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isLocalDevRequest(req),
});

// --- Middleware ---
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(helmet());
app.use(compression());
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buf) => {
    req.rawBody = Buffer.from(buf);
  },
}));
app.use(apiRateLimit);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/backups", express.static(path.join(__dirname, "backups")));

// --- MongoDB Connection ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected".green))
  .catch((err) => console.error("MongoDB connection error:".red, err));

// --- Socket.IO Setup ---
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error(`Socket CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log("🔗 Client connected:", socket.id);

  // ✅ everyone joins their OWN room using their own id
  socket.on("joinRoom", ({ userId, role }) => {
    if (!userId) return;
    socket.join(userId.toString());
    console.log(`✅ ${role || "client"} joined room ${userId}`);
  });

  /**
   * ✅ Unified sendMessage payload (frontend must send these):
   * {
   *   content,
   *   senderId,
   *   senderType: "user" | "admin",
   *   recipientId
   * }
   */
  socket.on("sendMessage", async ({ content, senderId, senderType, recipientId }) => {
    if (!content || !senderId || !senderType) {
      return socket.emit("messageError", { error: "Missing required fields" });
    }

    try {
      let finalRecipientId;
      let senderName;
      let senderModel;
      let recipientName;
      let recipientModel;
      let recipientType;

      // -------------------------
      // USER -> ADMIN
      // -------------------------
      if (senderType === "user") {
        // ✅ prefer recipientId (assigned admin) if provided
        let admin = null;

        if (recipientId) {
          admin = await AdminUser.findById(recipientId);
          if (!admin) {
            return socket.emit("messageError", { error: "Invalid admin recipientId" });
          }
        } else {
          // fallback: first admin
          admin = await AdminUser.findOne();
          if (!admin) {
            return socket.emit("messageError", { error: "No admin available" });
          }
        }

        finalRecipientId = admin._id;

        const userDoc = await User.findById(senderId);
        senderName = userDoc?.name || "User";

        senderModel = "User";
        recipientModel = "AdminUser";
        recipientName = admin.name;
        recipientType = "admin";
      }

      // -------------------------
      // ADMIN -> USER
      // -------------------------
      else if (senderType === "admin") {
        if (!recipientId) {
          return socket.emit("messageError", { error: "Admin recipientId required" });
        }

        const userDoc = await User.findById(recipientId);
        if (!userDoc) {
          return socket.emit("messageError", { error: "Invalid user recipientId" });
        }

        finalRecipientId = userDoc._id;

        const adminDoc = await AdminUser.findById(senderId);
        senderName = adminDoc?.name || "Admin";

        senderModel = "AdminUser";
        recipientModel = "User";
        recipientName = userDoc.name || "User";
        recipientType = "user";
      }

      const newMessage = await Message.create({
        content,
        senderId,
        senderType,
        recipientId: finalRecipientId,
        recipientType,
        senderModel,
        recipientModel,
        senderName,
        recipientName,
      });

      // ✅ IMPORTANT: emit to BOTH rooms
      // recipient gets it
      io.to(finalRecipientId.toString()).emit("receiveMessage", newMessage);
      // sender also gets it (so UI updates even without optimistic state)
      io.to(senderId.toString()).emit("receiveMessage", newMessage);

      socket.emit("messageSent", newMessage);
    } catch (err) {
      console.error("❌ sendMessage error:", err);
      socket.emit("messageError", { error: "Failed to send message" });
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});

// --- API Routes ---
app.use("/api/auth", require("./routes/auth"));
app.use("/api/admins", require("./routes/AdminRoutes"));
app.use("/api/users", require("./routes/users"));
app.use("/api/tasks", require("./routes/TaskRoutes"));
app.use("/api/jobs", require("./routes/jobs"));
app.use("/api/applications", require("./routes/applications"));
app.use("/api/wishlist", require("./routes/wishlist"));
app.use("/api/chats", require("./routes/chat"));
app.use("/api/inquiries", require("./routes/inquiries"));
app.use("/api/analytics", require("./routes/analytics"));
app.use("/api/agent", require("./routes/agent"));
app.use("/api", require("./routes/documents"));
app.use("/api/overview", require("./routes/overview"));
app.use("/api/sales-admin", require("./routes/SalesAdminRoutes"));
app.use("/api/projects", require("./routes/projects"));
app.use("/api/campaigns", require("./routes/campaigns"));
app.use("/api/recruitment-channels", require("./routes/recruitmentChannels"));
app.use("/api/recruitment-settings", require("./routes/recruitmentSettings"));
app.use("/api/interview-schedules", require("./routes/interviewSchedules"));
app.use("/api/leads", require("./routes/leads"));
app.use("/api/utilities", require("./routes/utilities"));
app.use("/api/meetings", require("./routes/meetings"));
app.use("/api/activity-logs", require("./routes/activityLogs"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/whatsapp/ai-agent", require("./routes/whatsappAiAgent"));
app.use("/api/whatsapp/ai-intent-matching", require("./routes/whatsappAiIntentMatching"));
app.use("/api/whatsapp", require("./routes/whatsapp"));
app.use("/api/whatsapp-automations", require("./routes/whatsappAutomation"));
app.use("/", require("./routes/whatsapp"));

// --- Serve frontend in production ---
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../jobportal/dist")));

  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.resolve(__dirname, "../jobportal/dist", "index.html"));
  });
}

// --- Start server ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  startWhatsAppAutomationWorker(app);
  startWhatsAppCampaignWorker(app);
  console.log(`🚀 Server running on port ${PORT}`.blue.bold);
  console.log(`📡 Socket.IO enabled for real-time chat`.cyan);
});

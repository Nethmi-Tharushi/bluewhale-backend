// server/routes/chatUsers.js
const express = require('express');
const router  = express.Router();
const ChatUser = require('../models/ChatUser');
const User     = require('../models/User');

// GET /api/chat-users
// Returns all users who have chatted, with unread count & basic info
router.get('/', async (req, res) => {
  try {
    const chatUsers = await ChatUser.find({}).lean();
    const userIds   = chatUsers.map(cu => cu.userId);
    const users     = await User.find({ _id: { $in: userIds } })
                                .select('name email')
                                .lean();

    const result = chatUsers.map(cu => {
      const user = users.find(u => u._id.equals(cu.userId));
      return {
        userId:      cu.userId,
        name:        user?.name || null,
        email:       user?.email || null,
        unreadCount: cu.unreadCount,
        lastMessage: cu.lastMessage,
        updatedAt:   cu.updatedAt
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Error in /api/chat-users:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

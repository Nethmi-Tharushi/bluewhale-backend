const express = require('express');
const router = express.Router();
const Message = require('../models/Message');

// Get all messages in a room (userId)
router.get('/:room', async (req, res) => {
  try {
    const messages = await Message.find({ room: req.params.room }).sort('timestamp');
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save a new message
router.post('/', async (req, res) => {
  try {
    const { room, sender, message } = req.body;
    const newMessage = new Message({ room, sender, message });
    await newMessage.save();
    res.status(201).json(newMessage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

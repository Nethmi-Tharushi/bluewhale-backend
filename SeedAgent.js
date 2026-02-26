const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User'); // Adjust path if needed

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/bluewhale', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Seed agent
const seedAgent = async () => {
  try {
    // Remove existing agent with same email
    await User.deleteOne({ email: 'agent@example.com' });

    const agent = await User.create({
      name: 'Global Recruitment',
      userType: 'agent',
      email: 'agent@example.com',
      password: 'Password123', // will be hashed by pre-save hook
      phoneNumber: '+94123456789',
      companyName: 'Global Recruitment Ltd',
      companyAddress: '123 Main St, Colombo, Sri Lanka',
      contactPerson: 'John Doe',
      isVerified: true,
      companyLogo: 'https://example.com/logo.png',
      managedCandidates: [
        {
          name: 'Jane Smith',
          email: 'jane.smith@example.com',
          phone: '+94111222333',
          cv: 'https://example.com/janeCV.pdf',
          skills: ['JavaScript', 'Node.js', 'React'],
          experience: '3 years',
          priority: 'Medium',
        },
      ],
    });

    console.log('Agent seeded successfully:', agent);
    process.exit();
  } catch (err) {
    console.error('Error seeding agent:', err);
    process.exit(1);
  }
};

seedAgent();

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const AdminUser = require('./models/AdminUser'); // Adjust path if needed

async function seedUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    // Users to seed
    const users = [
      {
        name: 'Super Admin',
        email: 'admin@gmail.com',
        password: 'admin123',
        role: 'MainAdmin',
      },
      {
        name: 'Sales User',
        email: 'sales@gmail.com',
        password: 'sales123',
        role: 'SalesAdmin',
      },
      // {
      //   name: 'Agent User',
      //   email: 'agent@gmail.com',
      //   password: 'agent123',
      //   role: 'AgentAdmin',
      // },
      // {
      //   name: 'Sarah Johnson',
      //   email: 'sarah@gmail.com',
      //   password: 'sarah123',
      //   role: 'SalesAdmin',
      // }
    ];

    for (const userData of users) {
      const existingUser = await AdminUser.findOne({ email: userData.email });
      if (existingUser) {
        console.log(`${userData.role} user already exists: ${userData.email}`);
        continue;
      }

      const hashedPassword = await bcrypt.hash(userData.password, 10);

      const user = new AdminUser({
        name: userData.name,
        email: userData.email,
        password: hashedPassword,
        role: userData.role,
      });

      await user.save();
      console.log(`${userData.role} user created: ${userData.email}`);
    }

    console.log('Seeding done');
    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
}

seedUsers();

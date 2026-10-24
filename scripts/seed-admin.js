const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config();

const { connectDB } = require('../config/db');
const User = require('../models/User');

async function seedAdmin() {
  const adminName = (process.env.SUPER_ADMIN_NAME || '').trim();
  const adminEmail = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD;
  const adminPhone = process.env.SUPER_ADMIN_PHONE || '';

  try {
    if (!adminName || !adminEmail || !adminPassword) {
      throw new Error('Set SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL, and SUPER_ADMIN_PASSWORD privately before startup');
    }

    await connectDB();

    const existing = await User.findOne({ email: adminEmail });
    if (existing) {
      console.log('Super-admin account already exists; bootstrap made no changes.');
      return;
    }

    const user = await User.create({
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      phone: adminPhone,
      role: 'super_admin',
      status: 'active',
    });

    console.log('Super admin created successfully');
    console.log(JSON.stringify({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    }, null, 2));
  } catch (error) {
    console.error('Failed to seed super admin:', error.message);
    process.exit(1);
  } finally {
    const mongoose = require('mongoose');
    await mongoose.connection.close();
  }
}

seedAdmin();

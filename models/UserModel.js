import mongoose from 'mongoose';

const resetPasswordSchema = new mongoose.Schema({
  otpHash: { type: String },
  otpExpires: { type: Date },
  otpAttempts: { type: Number, default: 0 },
  verified: { type: Boolean, default: false },
  resetTokenUsed: { type: Boolean, default: false },
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 8, // match backend policy
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  // embed resetPassword subdocument
  resetPassword: {
    type: resetPasswordSchema,
    default: undefined,
  }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

export default User;

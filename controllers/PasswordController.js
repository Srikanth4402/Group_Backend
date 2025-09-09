import jwt from 'jsonwebtoken';
import User from '../models/UserModel.js';
import {sendMail} from '../utils/MailSender.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
 
const forgotPassword = async (req, res) => {
  const { email } = req.body;
 
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
 
    // Generate a random OTP
    const otp = crypto.randomInt(100000, 999999).toString();
 
    // Generate a JWT token (valid for 10 minutes)
    const token = jwt.sign({ email, otp }, process.env.JWT_SECRET, { expiresIn: '10m' });
 
    // Send OTP via email
    await sendMail(email, 'Password Reset OTP', `Your OTP is: ${otp}`);
 
    res.status(200).json({ message: 'OTP sent successfully to your email', token }); // Send token to the frontend
  } catch (error) {
    res.status(500).json({ message: 'Error sending OTP', error: error.message || error });
  }
};
 
const validateOtp = async (req, res) => {
  const { token, otp } = req.body;
 
  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
 
    // Check if the OTP matches
    if (decoded.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }
 
    res.status(200).json({ message: 'OTP validated successfully' }); // Move to the next step in the frontend
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ message: 'Token expired' });
    }
    res.status(500).json({ message: 'Error validating OTP', error: error.message || error });
  }
};
 
const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;
 
  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
 
    // Find the user
    const user = await User.findOne({ email: decoded.email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
 
    // Check if the new password is the same as the old password
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ message: 'New password cannot be the same as the old password. Please enter a different password.' });
    }
 
    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword,salt);
    // const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword; // Update the password
    await user.save();
 
    res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ message: 'Token expired' });
    }
    console.log("Error resetting password", error, error.message);
    res.status(500).json({ message: 'Error resetting password', error: error.message || error });
  }
};
 
export{
  forgotPassword,
  validateOtp,
  resetPassword,
};
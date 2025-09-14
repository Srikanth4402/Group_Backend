import jwt from 'jsonwebtoken';
import User from '../models/UserModel.js';
import { sendMail } from '../utils/MailSender.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

const OTP_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_OTP_ATTEMPTS = 5;
const RESET_JWT_EXPIRES = '15m'; // short lived reset token

// Helper: respond generic to avoid user enumeration
const genericOtpSentResponse = (res) =>
  res.status(200).json({ message: 'If an account with that email exists, an OTP has been sent.' });

const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    console.log('forgotPassword: request for email:', email);

    // Always return generic response to avoid user enumeration
    if (!user) {
      // small delay optional
      return genericOtpSentResponse(res);
    }

    // Generate numeric OTP (6 digits)
    const otp = crypto.randomInt(100000, 999999).toString();

    // Hash the OTP before storing
    const otpHash = await bcrypt.hash(otp, 10);

    // Store OTP hash, expiry and attempts in user.resetPassword subdocument
    user.resetPassword = {
      otpHash,
      otpExpires: Date.now() + OTP_TTL_MS,
      otpAttempts: 0,
      verified: false,         // will be set true by validateOtp
      resetTokenUsed: false,   // will be set true after password reset
    };

    await user.save();

    // Send OTP by email (only plaintext OTP — reset token is issued later)
    // NOTE: in production avoid logging OTP; only for dev debugging uncomment cautiously
    // console.log(`Password reset OTP for ${email}: ${otp}`);

    const mailPayload = {
      to: email,
      subject: 'Password Reset OTP',
      text: `Your OTP is: ${otp}. It expires in 15 minutes. If you did not request this, please ignore this email.`,
    };

    await sendMail(mailPayload);

    return genericOtpSentResponse(res);
  } catch (error) {
    console.error('forgotPassword error:', error);
    // Do not return raw error to client
    return res.status(500).json({ message: 'Error processing request' });
  }
};

const validateOtp = async (req, res) => {
  const { email, otp } = req.body;
  console.log('validateOtp called with email:', email);
  if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.resetPassword || !user.resetPassword.otpHash) {
      return res.status(400).json({ message: 'Invalid OTP or expired' });
    }

    // Check expiry
    if (Date.now() > user.resetPassword.otpExpires) {
      // Clear expired info
      user.resetPassword = undefined;
      await user.save();
      return res.status(400).json({ message: 'OTP expired' });
    }

    // Check attempt limits
    if ((user.resetPassword.otpAttempts || 0) >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many OTP attempts. Please request a new OTP.' });
    }

    const match = await bcrypt.compare(otp, user.resetPassword.otpHash);
    if (!match) {
      user.resetPassword.otpAttempts = (user.resetPassword.otpAttempts || 0) + 1;
      await user.save();
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // OTP matched: mark verified and issue a short-lived reset JWT (no OTP inside)
    user.resetPassword.verified = true;
    user.resetPassword.otpAttempts = 0;
    await user.save();

    // Create reset token (JWT) that contains only email and purpose
    const resetToken = jwt.sign({ email: user.email, purpose: 'password-reset' }, process.env.JWT_SECRET, {
      expiresIn: RESET_JWT_EXPIRES,
    });

    return res.status(200).json({ message: 'OTP verified', resetToken });
  } catch (error) {
    console.error('validateOtp error:', error);
    return res.status(500).json({ message: 'Error validating OTP' });
  }
};

const resetPassword = async (req, res) => {
  const { resetToken, newPassword } = req.body;
  if (!resetToken || !newPassword) return res.status(400).json({ message: 'resetToken and newPassword are required' });

  try {
    // Verify reset token
    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') return res.status(400).json({ message: 'Reset token expired' });
      return res.status(400).json({ message: 'Invalid reset token' });
    }

    if (decoded.purpose !== 'password-reset' || !decoded.email) {
      return res.status(400).json({ message: 'Invalid reset token' });
    }

    const user = await User.findOne({ email: decoded.email });
    if (!user || !user.resetPassword || !user.resetPassword.verified) {
      return res.status(400).json({ message: 'Invalid or expired reset flow' });
    }

    // Prevent reuse of the reset flow
    if (user.resetPassword.resetTokenUsed) {
      return res.status(400).json({ message: 'Reset token already used' });
    }

    // Password policy: enforce minimum length (adjust as needed)
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    // Check new password not same as old (compare against stored hash)
    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) {
      return res.status(400).json({ message: 'New password cannot be the same as the old password' });
    }

    // Hash and store new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // Clear/reset resetPassword subdocument
    user.resetPassword = {
      otpHash: undefined,
      otpExpires: undefined,
      otpAttempts: 0,
      verified: false,
      resetTokenUsed: true,
    };

    await user.save();

    return res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('resetPassword error:', error);
    return res.status(500).json({ message: 'Error resetting password' });
  }
};

export { forgotPassword, validateOtp, resetPassword };

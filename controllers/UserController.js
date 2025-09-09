// controllers/UserController.js
import User from "../models/UserModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { sendMail } from "../utils/MailSender.js";

dotenv.config();


const requireEnv = (k) => {
  if (!process.env[k]) {
    console.warn(`[WARN] Missing env var: ${k}`);
  }
};

requireEnv("JWT_SECRET");

const generateToken = (user) => {
  const payload = {
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      userName: user.username,
    },
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });
};

//CREATE USER
export const createUser = async (req, res) => {
  try {
    let { username, email, password } = req.body || {};

    // Basic normalization
    username = typeof username === "string" ? username.trim() : "";
    email = typeof email === "string" ? email.trim().toLowerCase() : "";
    password = typeof password === "string" ? password : "";

    if (!username || !email || !password) {
      return res.status(400).json({ message: "Username, email and password are required" });
    }

    // Check conflicts
    const [usernameExists, emailExists] = await Promise.all([
      User.findOne({ username }),
      User.findOne({ email }),
    ]);

    if (usernameExists) {
      return res.status(409).json({ message: "Username  already exsits" });
    }
    if (emailExists) {
      return res.status(409).json({ message: "Email already exists " });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const newUser = await User.create({
      username,
      email,
      password: hashedPassword,
      role: "user",
    });

    (async () => {
      try {
        await sendMail({
          to: email,
          subject: "Welcome to Our E-Commerce Service",
          text: `Hello ${username},\n\nThank you for signing up! We're excited to have you.\n\nBest regards,\nYour Team`,
          html: `<p>Hello <b>${username}</b>,</p><p>Thank you for signing up! We're excited to have you.</p><p>Best regards,<br/>Your Team</p>`,
        });
      } catch (mailErr) {
        console.error("[Mail] Welcome email failed:", mailErr?.message || mailErr);
      }
    })();

    // Token
    const token = generateToken(newUser);

    return res.status(201).json({
      message: "User created successfully",
      token,
      userId: newUser._id,
      role: newUser.role,
      userName: newUser.username,
      email: newUser.email,
    });
  } catch (error) {
    console.error("Error creating user:", error);
    return res.status(500).json({ message: "Error creating user" });
  }
};

// ================== GET ALL USERS ==================
export const getUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");
    return res
      .status(200)
      .json({ message: "Users data fetched successfully", users });
  } catch (error) {
    console.error("Error getting users data:", error);
    return res.status(500).json({ message: "Error getting users data" });
  }
};

// ================== LOGIN ==================
export const loginUser = async (req, res) => {
  try {
    let { email, password } = req.body || {};
    email = typeof email === "string" ? email.trim().toLowerCase() : "";
    password = typeof password === "string" ? password : "";

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ message: "Invalid credentials" });

    const token = generateToken(user);
    const redirectedPath = user.role === "admin" ? "admin" : "user";

    return res.status(200).json({
      message: "Login successful",
      token,
      userId: user._id,
      redirectedPath,
      role: user.role,
      userName: user.username,
      email: user.email,
    });
  } catch (error) {
    console.error("Error logging in:", error);
    return res.status(500).json({ message: "Error logging in" });
  }
};

// ================== GET SINGLE USER ==================
export const getUser = async (req, res) => {
  try {
    const { userId } = req.params || {};
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    const user = await User.findById(userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    return res.status(200).json({ message: "User fetched successfully", user });
  } catch (error) {
    console.error("Error fetching user:", error);
    return res.status(500).json({ message: "Error fetching user" });
  }
};

// ================== UPDATE PROFILE ==================
export const updateProfile = async (req, res) => {
  try {
    const { userId } = req.params || {};
    let { username, email } = req.body || {};

    username = typeof username === "string" ? username.trim() : "";
    email = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    if (!username || !email) {
      return res.status(400).json({ message: "Username and email are required" });
    }

    // Conflicts (exclude current user)
    const [emailExists, usernameExists] = await Promise.all([
      User.findOne({ email, _id: { $ne: userId } }),
      User.findOne({ username, _id: { $ne: userId } }),
    ]);

    if (emailExists) {
      return res.status(409).json({ message: "Email already taken" });
    }
    if (usernameExists) {
      return res.status(409).json({ message: "Username already taken" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { username, email },
      { new: true }
    ).select("-password");

    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    return res.status(200).json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    return res.status(500).json({ message: "Error updating profile" });
  }
};

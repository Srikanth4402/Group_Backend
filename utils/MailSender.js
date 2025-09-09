
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",   
  port: 465,                
  secure: true,            
  auth: {
    user: process.env.EMAIL_USER,     
    pass: process.env.EMAIL_PASSWORD, 

    
  },
  connectionTimeout: 30_000,
  greetingTimeout: 20_000,
  socketTimeout: 30_000,
});

export const sendMail = async ({ to, subject, text, html }) => {
  const mailOptions = {
    from: `"E-Commerce" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html, // optional
  };


  const info = await transporter.sendMail(mailOptions);
  return info;
};



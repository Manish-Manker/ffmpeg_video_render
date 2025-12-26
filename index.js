import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import cron from "node-cron";

import { dbConnection } from "./src/models/connectDB.js"

import { checkForRender } from "./src/videoRender.js";

dotenv.config();
dbConnection();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));


cron.schedule('*/1 * * * *', checkForRender, {
  scheduled: true,
  timezone: "UTC"
});


console.log("Cron job scheduled to run every 50 seconds");

// Run the task immediately on server start
checkForRender();

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Server is running",
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
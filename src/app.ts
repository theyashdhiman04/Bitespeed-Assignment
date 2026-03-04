import express from "express";
import { contactRouter } from "./routes/contactRoutes";

export const app = express();

app.use(express.json());
app.use(contactRouter);

// Health-check endpoint
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

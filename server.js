import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

// Root Route
app.get("/", (req, res) => {
  res.send("API Running Successfully!");
});

// Numbers API
app.get("/numbers", (req, res) => {
  res.json({
    status: "success",
    message: "Numbers API working"
  });
});

// SMS API
app.get("/sms", (req, res) => {
  res.json({
    status: "success",
    message: "SMS API working"
  });
});

app.listen(PORT, () => {
  console.log("Server running on port:", PORT);
});

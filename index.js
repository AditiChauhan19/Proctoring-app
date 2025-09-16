// server/index.js
// Simple API for saving proctoring events and fetching reports
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

require('dotenv').config();

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cors());

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/proctoring_demo';
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('MongoDB connected'))
  .catch(err => console.error('Mongo connect err', err));

const EventSchema = new mongoose.Schema({
  candidate: String,
  type: String,
  timestamp: Number,
  meta: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

const Event = mongoose.model('Event', EventSchema);

app.post('/logs', async (req, res) => {
  try {
    const { candidate, type, timestamp, meta } = req.body;
    if (!type || !timestamp) return res.status(400).json({ error: 'type and timestamp required' });
    const ev = new Event({ candidate, type, timestamp, meta });
    await ev.save();
    return res.json({ ok: true, id: ev._id });
  } catch(err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

// fetch events for a candidate (optionally date range)
app.get('/reports/:candidate', async (req, res) => {
  try {
    const candidate = req.params.candidate;
    const events = await Event.find({ candidate }).sort({ timestamp: 1 }).lean();
    return res.json({ ok:true, events });
  } catch(err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=> console.log(`Server running on ${PORT}`));

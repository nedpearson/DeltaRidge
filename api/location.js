export default function handler(req, res) {
  // Vercel populates these headers automatically based on the client IP
  const lat = req.headers['x-vercel-ip-latitude'];
  const lon = req.headers['x-vercel-ip-longitude'];
  
  if (lat && lon) {
    res.status(200).json({ latitude: lat, longitude: lon });
  } else {
    // Fallback to Baton Rouge if headers are missing
    res.status(200).json({ latitude: '30.4583', longitude: '-91.1403' });
  }
}

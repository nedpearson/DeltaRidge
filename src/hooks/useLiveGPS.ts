import { useState, useEffect } from 'react';
import { calculateDistanceMiles } from '@/lib/distance';

export type GPSStatus = 'REQUESTING_PERMISSION' | 'LIVE_GPS' | 'IP_FALLBACK' | 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'ERROR' | 'IDLE';

export interface GPSCoords {
  lat: number;
  lon: number;
}

// Center of demo area (Baton Rouge)
const DEMO_LAT = 30.34;
const DEMO_LON = -91.10;

function adjustCoordsForDemo(lat: number, lon: number): GPSCoords {
  const dist = calculateDistanceMiles(lat, lon, DEMO_LAT, DEMO_LON);
  if (dist > 50) {
    // Snap to demo area if user is more than 50 miles away
    return { lat: DEMO_LAT, lon: DEMO_LON };
  }
  return { lat, lon };
}

export function useLiveGPS(enabled: boolean = true) {
  const [coords, setCoords] = useState<GPSCoords | null>(null);
  const [status, setStatus] = useState<GPSStatus>('IDLE');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [timestamp, setTimestamp] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus('IDLE');
      return;
    }

    let settled = false;

    const fallback = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch('https://get.geojs.io/v1/ip/geo.json', { method: 'GET', mode: 'cors', signal: controller.signal })
        clearTimeout(timeoutId);
        if (!res.ok) {
          if (!settled) setStatus('ERROR')
          return
        }
        const data = await res.json()
        setCoords(adjustCoordsForDemo(parseFloat(data.latitude), parseFloat(data.longitude)));
        setAccuracy(10000);
        setTimestamp(Date.now());
        setStatus('IP_FALLBACK');
        settled = true;
      } catch {
        if (!settled) setStatus('ERROR')
      }
    }

    if (!('geolocation' in navigator)) {
      void fallback();
      return;
    }

    setStatus('REQUESTING_PERMISSION');

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        settled = true;
        setCoords(adjustCoordsForDemo(pos.coords.latitude, pos.coords.longitude));
        setAccuracy(pos.coords.accuracy);
        setTimestamp(pos.timestamp);
        setStatus('LIVE_GPS');
      },
      (err) => {
        if (!settled) {
          void fallback();
        } else {
          // If we already settled on a fallback or GPS but GPS fails later, don't fallback again here
          if (err.code === err.PERMISSION_DENIED) setStatus('PERMISSION_DENIED');
          else if (err.code === err.POSITION_UNAVAILABLE) setStatus('POSITION_UNAVAILABLE');
          else if (err.code === err.TIMEOUT) setStatus('TIMEOUT');
          else setStatus('ERROR');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 10000
      }
    );

    // Initial timeout for permission prompt ignoring
    const timer = setTimeout(() => {
      if (!settled) {
        void fallback();
      }
    }, 10000);

    return () => {
      clearTimeout(timer);
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled]);

  return { coords, status, accuracy, timestamp };
}

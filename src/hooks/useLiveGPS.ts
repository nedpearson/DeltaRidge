import { useState, useEffect } from 'react';

export type GPSStatus = 'REQUESTING_PERMISSION' | 'LIVE_GPS' | 'IP_FALLBACK' | 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'ERROR' | 'IDLE';

export interface GPSCoords {
  lat: number;
  lon: number;
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
        const res = await fetch('https://get.geojs.io/v1/ip/geo.json', { method: 'GET', mode: 'cors' })
        if (!res.ok) {
          if (!settled) setStatus('ERROR')
          return
        }
        const data = await res.json()
        setCoords({
          lat: parseFloat(data.latitude),
          lon: parseFloat(data.longitude)
        });
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
        setCoords({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude
        });
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

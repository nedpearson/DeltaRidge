import { useState, useEffect } from 'react';

export type GPSStatus = 'REQUESTING_PERMISSION' | 'LIVE_GPS' | 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'ERROR' | 'IDLE';

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

    if (!('geolocation' in navigator)) {
      setStatus('ERROR');
      return;
    }

    setStatus('REQUESTING_PERMISSION');

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude
        });
        setAccuracy(pos.coords.accuracy);
        setTimestamp(pos.timestamp);
        setStatus('LIVE_GPS');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setStatus('PERMISSION_DENIED');
        else if (err.code === err.POSITION_UNAVAILABLE) setStatus('POSITION_UNAVAILABLE');
        else if (err.code === err.TIMEOUT) setStatus('TIMEOUT');
        else setStatus('ERROR');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 10000
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled]);

  return { coords, status, accuracy, timestamp };
}

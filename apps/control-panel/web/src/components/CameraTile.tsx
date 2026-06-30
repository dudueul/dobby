import { useEffect, useRef } from "react";
import { startCamera } from "../api";

// Live WebRTC view via the BFF → go2rtc. Cameras stay on VLAN30 (no internet);
// only the hub reaches them.
export function CameraTile({ camera }: { camera: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let pc: RTCPeerConnection | undefined;
    let cancelled = false;
    (async () => {
      if (!ref.current) return;
      try {
        pc = await startCamera(ref.current, camera);
      } catch (err) {
        if (!cancelled) console.error(`camera ${camera}:`, err);
      }
    })();
    return () => { cancelled = true; pc?.close(); };
  }, [camera]);

  return (
    <div className="tile camera">
      <div className="tile-title">{camera.replace(/_/g, " ")}</div>
      <video ref={ref} autoPlay muted playsInline />
    </div>
  );
}

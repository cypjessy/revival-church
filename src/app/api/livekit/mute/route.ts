import { RoomServiceClient } from "livekit-server-sdk";

export async function POST(req: Request) {
  try {
    const { roomName, identity, trackSid } = await req.json();

    if (!roomName || !identity) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    const host = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || "";
    const apiKey = process.env.LIVEKIT_API_KEY || process.env.NEXT_PUBLIC_LIVEKIT_API_KEY || "";
    const apiSecret = process.env.LIVEKIT_API_SECRET || process.env.NEXT_PUBLIC_LIVEKIT_API_SECRET || "";

    if (!host || !apiKey || !apiSecret) {
      return Response.json({ error: "LiveKit credentials not configured" }, { status: 500 });
    }

    const apiHost = host.replace(/^wss?:\/\//, "https://");
    const client = new RoomServiceClient(apiHost, apiKey, apiSecret);

    if (trackSid) {
      await client.mutePublishedTrack(roomName, identity, trackSid, true);
    } else {
      const participant = await client.getParticipant(roomName, identity);
      const audioTracks = participant.tracks?.filter((t) => t.type === 0) || []; // TrackType.AUDIO = 0
      await Promise.all(audioTracks.map((t) => client.mutePublishedTrack(roomName, identity, t.sid, true)));
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error("Failed to mute participant:", e);
    return Response.json({ error: e instanceof Error ? e.message : "Failed to mute" }, { status: 500 });
  }
}

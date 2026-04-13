import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, Linking, Platform } from 'react-native';
import { RTCPeerConnection, RTCSessionDescription, mediaDevices } from 'react-native-webrtc';

export default function App() {
  const [serverUrl, setServerUrl] = useState('');
  const [sessionCode, setSessionCode] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  const pcRef = useRef(null);
  const streamRef = useRef(null);

  // Handle deep link: vialive://broadcast?server=<url>&code=<code>
  function handleDeepLink(url) {
    if (!url) return;
    try {
      const serverMatch = url.match(/[?&]server=([^&]+)/);
      const codeMatch = url.match(/[?&]code=([^&]+)/);
      if (serverMatch) setServerUrl(decodeURIComponent(serverMatch[1]));
      if (codeMatch) setSessionCode(decodeURIComponent(codeMatch[1]).toUpperCase());
    } catch (e) {
      console.warn('Deep link parse error:', e);
    }
  }

  useEffect(() => {
    // App opened via deep link (cold start)
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url);
    });

    // App already open and receives a deep link
    const subscription = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
    return () => subscription.remove();
  }, []);

  const startBroadcast = async () => {
    if (!serverUrl || !sessionCode) {
      Alert.alert('Missing Info', 'Please enter both the Server URL and Session Code.');
      return;
    }

    try {
      const cleanUrl = serverUrl.trim().replace(/\/$/, '');

      // 1. Fetch ICE config (STUN + TURN) from the backend so the APK can relay
      //    through TURN when a direct UDP path to MediaMTX is blocked.
      let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
      try {
        const iceRes = await fetch(`${cleanUrl}/api/ice-config`, { method: 'GET' });
        if (iceRes.ok) {
          const iceJson = await iceRes.json();
          if (Array.isArray(iceJson.iceServers) && iceJson.iceServers.length > 0) {
            iceServers = iceJson.iceServers;
          }
        }
      } catch (iceErr) {
        console.warn('Could not fetch ICE config, using STUN-only fallback:', iceErr);
      }

      // 2. Capture screen. Try with audio first; fall back to video-only because
      //    internal audio capture is unsupported on many Android versions.
      let stream;
      try {
        stream = await mediaDevices.getDisplayMedia({ video: true, audio: true });
      } catch (audioErr) {
        console.warn('getDisplayMedia with audio failed, retrying video-only:', audioErr);
        stream = await mediaDevices.getDisplayMedia({ video: true, audio: false });
      }
      streamRef.current = stream;

      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      stream.getVideoTracks().forEach((track) => pc.addTrack(track, stream));

      // 3. Register onicecandidate BEFORE setLocalDescription so we never miss
      //    any candidate. react-native-webrtc's localDescription.sdp is a snapshot
      //    from setLocalDescription time and does NOT update with gathered candidates,
      //    so we collect them here and inject manually if needed.
      const gatheredCandidates = [];
      const iceGatheringDone = new Promise((resolve) => {
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            gatheredCandidates.push(event.candidate.candidate);
          } else {
            resolve(); // null candidate = ICE gathering complete
          }
        };
        setTimeout(resolve, 10000); // safety: proceed after 10 s regardless
      });

      // 4. Track ICE connection state. Show "broadcasting" only when ICE
      //    actually connects; alert the user if it fails.
      pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState;
        if (s === 'connected' || s === 'completed') {
          setIsBroadcasting(true);
        } else if (s === 'failed') {
          Alert.alert(
            'Stream Connection Failed',
            'Could not establish a media path to the server.\n\n' +
            'Ask the server admin to open UDP port 8190 in the firewall, then retry.'
          );
          stopBroadcast();
        } else if (s === 'disconnected') {
          setIsBroadcasting(false);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer); // triggers ICE gathering

      if (pc.iceGatheringState !== 'complete') {
        await iceGatheringDone;
      }

      // 5. Build final SDP. Inject gathered candidates if localDescription.sdp
      //    doesn't already contain them (react-native-webrtc behaviour).
      let sdpToSend = pc.localDescription.sdp;
      if (!sdpToSend.includes('a=candidate') && gatheredCandidates.length > 0) {
        const candidateLines = gatheredCandidates.map((c) => 'a=' + c).join('\r\n');
        sdpToSend = sdpToSend.trimEnd() + '\r\n' + candidateLines + '\r\n';
      }

      const whipUrl = `${cleanUrl}/live/${sessionCode.toLowerCase().trim()}/whip`;
      const response = await fetch(whipUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: sdpToSend,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Server rejected connection: ${response.status}${body ? '\n' + body.slice(0, 200) : ''}`);
      }

      const answerSdp = await response.text();
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));

      // setIsBroadcasting(true) is called by oniceconnectionstatechange once ICE
      // actually connects — not here, to avoid false "broadcasting" status.
      stream.getTracks()[0].onended = () => stopBroadcast();
    } catch (err) {
      console.error(err);
      Alert.alert('Broadcast Failed', err.message);
      stopBroadcast();
    }
  };

  const stopBroadcast = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    setIsBroadcasting(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ViaLive Broadcaster</Text>
      <Text style={styles.subtitle}>Android Screen Share Bridge</Text>

      <View style={styles.card}>
        <Text style={styles.label}>WHIP Server URL</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="https://vialive.example.com:8889"
          placeholderTextColor="#475569"
          autoCapitalize="none"
          keyboardType="url"
          editable={!isBroadcasting}
        />

        <Text style={styles.label}>Session Code</Text>
        <TextInput
          style={styles.input}
          value={sessionCode}
          onChangeText={(v) => setSessionCode(v.toUpperCase())}
          placeholder="e.g. ABCD"
          placeholderTextColor="#475569"
          autoCapitalize="characters"
          editable={!isBroadcasting}
        />

        {!isBroadcasting ? (
          <TouchableOpacity style={styles.buttonStart} onPress={startBroadcast}>
            <Text style={styles.buttonText}>Start Broadcast</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.buttonStop} onPress={stopBroadcast}>
            <Text style={styles.buttonText}>Stop Broadcast</Text>
          </TouchableOpacity>
        )}
      </View>

      {isBroadcasting && (
        <Text style={styles.status}>Broadcasting screen and audio</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#94a3b8',
    marginBottom: 32,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    elevation: 4,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 14,
    marginBottom: 8,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#0f172a',
    color: '#ffffff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  buttonStart: {
    backgroundColor: '#059669',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  buttonStop: {
    backgroundColor: '#e11d48',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  status: {
    marginTop: 24,
    color: '#10b981',
    fontSize: 16,
    fontWeight: '600',
  },
});

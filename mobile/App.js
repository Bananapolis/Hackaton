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
      // Try with audio first; fall back to video-only because internal audio
      // capture is unsupported on many Android versions and rejects the whole call.
      let stream;
      try {
        stream = await mediaDevices.getDisplayMedia({ video: true, audio: true });
      } catch (audioErr) {
        console.warn('getDisplayMedia with audio failed, retrying video-only:', audioErr);
        stream = await mediaDevices.getDisplayMedia({ video: true, audio: false });
      }
      streamRef.current = stream;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete so the SDP contains actual
      // a=candidate lines. Without this MediaMTX never receives reachable
      // candidates, ICE fails, and the path is torn down before WHEP connects.
      // Set handler BEFORE checking state to avoid a race condition.
      await new Promise((resolve) => {
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') resolve();
        };
        if (pc.iceGatheringState === 'complete') resolve();
        setTimeout(resolve, 10000); // safety: send after 10 s regardless
      });

      const cleanUrl = serverUrl.trim().replace(/\/$/, '');
      const whipUrl = `${cleanUrl}/live/${sessionCode.toLowerCase().trim()}/whip`;

      const response = await fetch(whipUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp, // use SDP updated with gathered candidates
      });

      if (!response.ok) {
        throw new Error(`Server rejected connection: ${response.status}`);
      }

      const answerSdp = await response.text();
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));

      setIsBroadcasting(true);

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

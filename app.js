const workerInput = document.querySelector('#worker');
const accessInput = document.querySelector('#access');
const roomInput = document.querySelector('#room');
const connectButton = document.querySelector('#connect');
const disconnectButton = document.querySelector('#disconnect');
const status = document.querySelector('#status');
const connectCard = document.querySelector('#connect-card');
const sessionCard = document.querySelector('#session-card');
const screenVideo = document.querySelector('#screen');
const cameraVideo = document.querySelector('#camera');

let socket;
let peer;
let parentToken;

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

function setStatus(message) { status.textContent = message; }

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function connect() {
  const worker = workerInput.value.trim().replace(/\/$/, '');
  const accessCode = accessInput.value;
  const room = roomInput.value.trim();
  if (!worker.startsWith('https://') || accessCode.length < 8 || room.length < 6) {
    setStatus('Enter an HTTPS Worker URL, the parent access code, and a pairing code of at least 6 characters.');
    return;
  }
  connectButton.disabled = true;
  setStatus('Authenticating parent dashboard…');
  try {
    const authResponse = await fetch(`${worker}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessCode })
    });
    if (!authResponse.ok) throw new Error('parent authentication failed');
    parentToken = (await authResponse.json()).token;
  } catch (error) {
    setStatus(`Authentication failed: ${error.message}`);
    connectButton.disabled = false;
    return;
  }
  setStatus('Authenticated. Waiting for the child device to approve a session…');
  peer = new RTCPeerConnection({ iceServers });
  peer.onicecandidate = event => {
    if (event.candidate) send({ type: 'ice', candidate: event.candidate });
  };
  peer.ontrack = event => {
    const track = event.track;
    const stream = event.streams[0] || new MediaStream([track]);
    if (track.label.toLowerCase().includes('screen')) screenVideo.srcObject = stream;
    else if (track.label.toLowerCase().includes('camera')) cameraVideo.srcObject = stream;
    else if (!screenVideo.srcObject) screenVideo.srcObject = stream;
    else cameraVideo.srcObject = stream;
    sessionCard.classList.remove('hidden');
    setStatus('Live session connected.');
  };
  peer.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) setStatus('Session disconnected.');
  };
  try {
    const url = worker.replace(/^https:\/\//, 'wss://') + `/signal?room=${encodeURIComponent(room)}&role=parent&token=${encodeURIComponent(parentToken)}`;
    socket = new WebSocket(url);
    socket.onopen = () => setStatus('Connected. Waiting for child approval…');
    socket.onmessage = async event => {
      const message = JSON.parse(event.data);
      if (message.type === 'offer') {
        await peer.setRemoteDescription(message.sdp ? { type: 'offer', sdp: message.sdp } : message.description);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        send({ type: 'answer', sdp: answer.sdp });
      } else if (message.type === 'ice' && message.candidate) {
        await peer.addIceCandidate(message.candidate);
      }
    };
    socket.onerror = () => setStatus('Could not connect to the signaling Worker.');
    socket.onclose = () => setStatus('Signaling connection closed.');
  } catch (error) {
    setStatus(`Connection failed: ${error.message}`);
    connectButton.disabled = false;
  }
}

function disconnect() {
  socket?.close();
  peer?.close();
  socket = undefined;
  peer = undefined;
  parentToken = undefined;
  screenVideo.srcObject = null;
  cameraVideo.srcObject = null;
  sessionCard.classList.add('hidden');
  connectButton.disabled = false;
  setStatus('Disconnected.');
}

connectButton.addEventListener('click', connect);
disconnectButton.addEventListener('click', disconnect);

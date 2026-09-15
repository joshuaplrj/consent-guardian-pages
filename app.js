import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getDatabase,
  onChildAdded,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCN1BZ0JKJKE688Sm8sffl8vSYeBBa7J6k',
  authDomain: 'consent-guardian.firebaseapp.com',
  databaseURL: 'https://consent-guardian-default-rtdb.firebaseio.com',
  projectId: 'consent-guardian',
  storageBucket: 'consent-guardian.firebasestorage.app',
  messagingSenderId: '674456363888',
  appId: '1:674456363888:web:bf6fffae7ce628e404e5b5',
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const database = getDatabase(firebaseApp);

const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const roomInput = document.querySelector('#room');
const signUpButton = document.querySelector('#signup');
const signInButton = document.querySelector('#signin');
const signOutButton = document.querySelector('#signout');
const connectButton = document.querySelector('#connect');
const disconnectButton = document.querySelector('#disconnect');
const authStatus = document.querySelector('#auth-status');
const status = document.querySelector('#status');
const sessionCard = document.querySelector('#session-card');
const screenVideo = document.querySelector('#screen');
const cameraVideo = document.querySelector('#camera');

let peer;
let roomRef;
let signalRef;
let signalUnsubscribe;
let pendingRemoteIce = [];
let remoteDescriptionSet = false;

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

function setStatus(message) { status.textContent = message; }

function authError(error) {
  const messages = {
    'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/weak-password': 'Use a password with at least 8 characters.',
  };
  return messages[error.code] || error.message;
}

async function createAccount() {
  try {
    await createUserWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
    authStatus.textContent = 'Parent account created and signed in.';
  } catch (error) {
    authStatus.textContent = authError(error);
  }
}

async function signIn() {
  try {
    await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
    authStatus.textContent = 'Signed in.';
  } catch (error) {
    authStatus.textContent = authError(error);
  }
}

function createPeer() {
  peer = new RTCPeerConnection({ iceServers });
  peer.onicecandidate = event => {
    if (event.candidate) sendSignal('ice', JSON.stringify(event.candidate.toJSON()));
  };
  peer.ontrack = event => {
    const track = event.track;
    const streamId = event.streams[0]?.id?.toLowerCase() || '';
    const trackLabel = track.label.toLowerCase();
    const stream = new MediaStream([track]);
    if (streamId.includes('screen') || trackLabel.includes('screen')) screenVideo.srcObject = stream;
    else if (streamId.includes('camera') || trackLabel.includes('camera')) cameraVideo.srcObject = stream;
    else if (!screenVideo.srcObject) screenVideo.srcObject = stream;
    else if (!cameraVideo.srcObject) cameraVideo.srcObject = stream;
    sessionCard.classList.remove('hidden');
    setStatus('Live session connected.');
  };
  peer.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
      setStatus('Session disconnected.');
    }
  };
}

async function sendSignal(type, payload) {
  const uid = auth.currentUser?.uid;
  if (!uid || !signalRef) return;
  await set(push(signalRef), { sender: uid, type, payload });
}

async function handleSignal(data) {
  if (!data || data.sender === auth.currentUser?.uid) return;
  if (data.type === 'offer') {
    await peer.setRemoteDescription({ type: 'offer', sdp: data.payload });
    remoteDescriptionSet = true;
    for (const candidate of pendingRemoteIce) await peer.addIceCandidate(candidate);
    pendingRemoteIce = [];
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await sendSignal('answer', answer.sdp);
  } else if (data.type === 'ice') {
    const candidate = JSON.parse(data.payload);
    if (remoteDescriptionSet) await peer.addIceCandidate(candidate);
    else pendingRemoteIce.push(candidate);
  }
}

async function connect() {
  const room = roomInput.value.trim();
  if (!auth.currentUser) {
    setStatus('Sign in before connecting.');
    return;
  }
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(room)) {
    setStatus('Use a one-time pairing code with 6–64 letters, numbers, _ or -.');
    return;
  }
  connectButton.disabled = true;
  setStatus('Creating a short-lived room…');
  roomRef = ref(database, `rooms/${room}`);
  signalRef = ref(database, `rooms/${room}/signals`);
  pendingRemoteIce = [];
  remoteDescriptionSet = false;
  try {
    await set(roomRef, {
      createdAt: serverTimestamp(),
      parentUid: auth.currentUser.uid,
    });
    signalUnsubscribe = onChildAdded(signalRef, snapshot => {
      handleSignal(snapshot.val()).catch(error => setStatus(`Signaling error: ${error.message}`));
    });
    createPeer();
    setStatus('Waiting for the child to approve screen/camera sharing…');
  } catch (error) {
    roomRef = undefined;
    signalRef = undefined;
    connectButton.disabled = false;
    setStatus(`Could not create room: ${error.message}`);
  }
}

async function disconnect() {
  signalUnsubscribe?.();
  signalUnsubscribe = undefined;
  peer?.close();
  peer = undefined;
  if (roomRef && auth.currentUser) {
    try { await remove(roomRef); } catch (_) { /* cleanup is best effort */ }
  }
  roomRef = undefined;
  signalRef = undefined;
  pendingRemoteIce = [];
  remoteDescriptionSet = false;
  screenVideo.srcObject = null;
  cameraVideo.srcObject = null;
  sessionCard.classList.add('hidden');
  connectButton.disabled = !auth.currentUser;
  setStatus('Disconnected.');
}

onAuthStateChanged(auth, user => {
  const signedIn = Boolean(user);
  authStatus.textContent = signedIn ? `Signed in as ${user.email}` : 'Not signed in.';
  emailInput.disabled = signedIn;
  passwordInput.disabled = signedIn;
  signUpButton.classList.toggle('hidden', signedIn);
  signInButton.classList.toggle('hidden', signedIn);
  signOutButton.classList.toggle('hidden', !signedIn);
  connectButton.disabled = !signedIn || Boolean(peer);
});

signUpButton.addEventListener('click', createAccount);
signInButton.addEventListener('click', signIn);
signOutButton.addEventListener('click', async () => {
  await disconnect();
  await signOut(auth);
});
connectButton.addEventListener('click', connect);
disconnectButton.addEventListener('click', disconnect);

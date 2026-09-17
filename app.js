import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  get,
  getDatabase,
  onChildAdded,
  onValue,
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
const frontCameraVideo = document.querySelector('#front-camera');
const backCameraVideo = document.querySelector('#back-camera');

let peer;
let roomRef;
let signalRef;
let roomUnsubscribe;
let signalUnsubscribe;
let reconnectTimer;
let explicitDisconnect = false;
let pendingRemoteIce = [];
let remoteDescriptionSet = false;
let activeSignalSession;

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

function setStatus(message) { status.textContent = message; }

function authError(error) {
  const messages = {
    'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
    'auth/invalid-credential': 'No matching parent account was found, or the password is incorrect. New parents should use Create parent account first.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/network-request-failed': 'Network unavailable. Check the connection and try again.',
    'auth/operation-not-allowed': 'Parent sign-in is not enabled for this Firebase project yet.',
    'auth/too-many-requests': 'Too many sign-in attempts. Wait a moment, then try again.',
    'auth/user-disabled': 'This parent account has been disabled. Contact the project owner.',
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

function closePeer() {
  const currentPeer = peer;
  peer = undefined;
  currentPeer?.close();
}

function replacePeer({ clearSession = true } = {}) {
  closePeer();
  if (clearSession) activeSignalSession = undefined;
  pendingRemoteIce = [];
  remoteDescriptionSet = false;
  return createPeer();
}

function scheduleReconnect() {
  if (explicitDisconnect || !roomRef || reconnectTimer) return;
  setStatus('Network interruption detected. Reconnecting automatically…');
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    if (explicitDisconnect || !roomRef) return;
    replacePeer();
    setStatus('Waiting for the child to reconnect…');
  }, 1500);
}

function createPeer() {
  const connection = new RTCPeerConnection({ iceServers });
  peer = connection;
  connection.onicecandidate = event => {
    if (event.candidate && connection === peer) {
      sendSignal('ice', JSON.stringify(event.candidate.toJSON()), activeSignalSession)
        .catch(error => setStatus(`Signaling error: ${error.message}`));
    }
  };
  connection.ontrack = event => {
    const track = event.track;
    const streamId = event.streams[0]?.id?.toLowerCase() || '';
    const trackLabel = track.label.toLowerCase();
    const stream = new MediaStream([track]);
    if (streamId.includes('screen') || trackLabel.includes('screen')) screenVideo.srcObject = stream;
    else if (streamId.includes('front') || trackLabel.includes('front')) frontCameraVideo.srcObject = stream;
    else if (streamId.includes('back') || trackLabel.includes('back') || trackLabel.includes('rear')) backCameraVideo.srcObject = stream;
    else if (!screenVideo.srcObject) screenVideo.srcObject = stream;
    else if (!frontCameraVideo.srcObject) frontCameraVideo.srcObject = stream;
    else if (!backCameraVideo.srcObject) backCameraVideo.srcObject = stream;
    sessionCard.classList.remove('hidden');
    setStatus('Live session connected.');
  };
  connection.onconnectionstatechange = () => {
    if (connection !== peer || explicitDisconnect) return;
    if (connection.connectionState === 'connected') {
      setStatus('Live session connected.');
    } else if (['failed', 'closed', 'disconnected'].includes(connection.connectionState)) {
      scheduleReconnect();
    }
  };
  return connection;
}

async function sendSignal(type, payload, sessionId = activeSignalSession) {
  const uid = auth.currentUser?.uid;
  if (!uid || !signalRef || !sessionId) return;
  await set(push(signalRef), { sender: uid, type, payload, sessionId });
}

async function handleSignal(data) {
  if (!data || data.sender === auth.currentUser?.uid || typeof data.sessionId !== 'string') return;
  if (data.type === 'offer') {
    if (data.sessionId !== activeSignalSession) {
      activeSignalSession = data.sessionId;
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      replacePeer({ clearSession: false });
    }
    const currentPeer = peer;
    if (!currentPeer) return;
    await currentPeer.setRemoteDescription({ type: 'offer', sdp: data.payload });
    remoteDescriptionSet = true;
    for (const candidate of pendingRemoteIce) await currentPeer.addIceCandidate(candidate);
    pendingRemoteIce = [];
    const answer = await currentPeer.createAnswer();
    await currentPeer.setLocalDescription(answer);
    await sendSignal('answer', answer.sdp, data.sessionId);
  } else if (data.type === 'ice' && data.sessionId === activeSignalSession) {
    const candidate = JSON.parse(data.payload);
    if (remoteDescriptionSet && peer) await peer.addIceCandidate(candidate);
    else pendingRemoteIce.push(candidate);
  }
}

function finishLocalSession(message) {
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  roomUnsubscribe?.();
  roomUnsubscribe = undefined;
  signalUnsubscribe?.();
  signalUnsubscribe = undefined;
  closePeer();
  roomRef = undefined;
  signalRef = undefined;
  pendingRemoteIce = [];
  remoteDescriptionSet = false;
  activeSignalSession = undefined;
  screenVideo.srcObject = null;
  frontCameraVideo.srcObject = null;
  backCameraVideo.srcObject = null;
  sessionCard.classList.add('hidden');
  connectButton.disabled = !auth.currentUser;
  setStatus(message);
}

function watchRoom() {
  roomUnsubscribe = onValue(roomRef, snapshot => {
    if (explicitDisconnect) return;
    if (!snapshot.exists()) {
      finishLocalSession('The pairing room ended.');
      return;
    }
    if (snapshot.child('closedAt').exists()) {
      finishLocalSession('The child stopped sharing from the Android device.');
    }
  }, error => {
    if (!explicitDisconnect) setStatus(`Room status error: ${error.message}`);
  });
}

async function connect() {
  const room = roomInput.value.trim();
  if (!auth.currentUser) {
    setStatus('Sign in before connecting.');
    return;
  }
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(room)) {
    setStatus('Use a pairing code with 6–64 letters, numbers, _ or -.');
    return;
  }
  explicitDisconnect = false;
  connectButton.disabled = true;
  setStatus('Opening the pairing room…');
  roomRef = ref(database, `rooms/${room}`);
  signalRef = ref(database, `rooms/${room}/signals`);
  pendingRemoteIce = [];
  remoteDescriptionSet = false;
  activeSignalSession = undefined;
  let createdHere = false;
  try {
    const existing = await get(roomRef);
    if (existing.exists()) {
      const data = existing.val() || {};
      if (data.parentUid !== auth.currentUser.uid) {
        throw new Error('That pairing code is already in use. Choose a new code.');
      }
      if (data.closedAt) {
        throw new Error('That pairing code was ended from the child device. Choose a new code.');
      }
    } else {
      await set(roomRef, {
        createdAt: serverTimestamp(),
        parentUid: auth.currentUser.uid,
      });
      createdHere = true;
    }
    watchRoom();
    signalUnsubscribe = onChildAdded(signalRef, snapshot => {
      handleSignal(snapshot.val()).catch(error => {
        setStatus(`Signaling error: ${error.message}`);
        scheduleReconnect();
      });
    });
    createPeer();
    setStatus('Waiting for the child to approve screen/camera sharing…');
  } catch (error) {
    if (createdHere && roomRef) {
      try { await remove(roomRef); } catch (_) { /* cleanup is best effort */ }
    }
    finishLocalSession(`Could not open pairing room: ${error.message}`);
  }
}

async function disconnect() {
  explicitDisconnect = true;
  const roomToRemove = roomRef;
  finishLocalSession('Disconnected.');
  if (roomToRemove && auth.currentUser) {
    try { await remove(roomToRemove); } catch (_) { /* cleanup is best effort */ }
  }
}

onAuthStateChanged(auth, user => {
  const signedIn = Boolean(user);
  authStatus.textContent = signedIn ? `Signed in as ${user.email}` : 'Not signed in.';
  emailInput.disabled = signedIn;
  passwordInput.disabled = signedIn;
  signUpButton.classList.toggle('hidden', signedIn);
  signInButton.classList.toggle('hidden', signedIn);
  signOutButton.classList.toggle('hidden', !signedIn);
  connectButton.disabled = !signedIn || Boolean(roomRef);
});

signUpButton.addEventListener('click', createAccount);
signInButton.addEventListener('click', signIn);
signOutButton.addEventListener('click', async () => {
  await disconnect();
  await signOut(auth);
});
connectButton.addEventListener('click', connect);
disconnectButton.addEventListener('click', disconnect);

import Privy, {
  LocalStorage,
  getEntropyDetailsFromUser,
  getUserEmbeddedEthereumWallet
} from '@privy-io/js-sdk-core';

const APP_ID = 'cms9qs943028x0climbe4nrgv';
const CLIENT_ID = matchMedia('(max-width: 700px)').matches
  ? 'client-WY6c36cAyFC5my5ZgQ92cpqf3S68QFG2LU2kqbmpzAubH'
  : 'client-WY6c36cAyFC5my5ZgQ92cpqf3S68QFG2LTtBv29YnUDkC';

const ROBINHOOD_CHAIN = {
  id: 4663,
  name: 'Robinhood Chain',
  network: 'robinhood',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] }, public: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } }
};

let client;
let secureFrame;
let currentUser;

function setMessage(message, error) {
  const el = document.getElementById('privyStatus');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('err', Boolean(error));
}
function showStep(step) {
  document.querySelectorAll('[data-privy-step]').forEach((el) => { el.hidden = el.dataset.privyStep !== step; });
}
function openDialog(step) {
  const modal = document.getElementById('privyModal');
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  showStep(step || 'email');
}
function closeDialog() {
  const modal = document.getElementById('privyModal');
  if (modal) modal.hidden = true;
  document.body.classList.remove('modal-open');
  setMessage('');
}
function safeParse(value) { try { return JSON.parse(value); } catch (_) { return null; } }

async function initialize() {
  if (client) return client;
  client = new Privy({ appId: APP_ID, clientId: CLIENT_ID, storage: new LocalStorage(), supportedChains: [ROBINHOOD_CHAIN] });
  await client.initialize();
  secureFrame = document.createElement('iframe');
  secureFrame.src = client.embeddedWallet.getURL();
  secureFrame.title = 'Privy secure wallet';
  secureFrame.setAttribute('aria-hidden', 'true');
  secureFrame.style.cssText = 'position:absolute;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(secureFrame);
  client.setMessagePoster(secureFrame.contentWindow);
  window.addEventListener('message', (event) => {
    if (!secureFrame || event.source !== secureFrame.contentWindow) return;
    const data = typeof event.data === 'string' ? safeParse(event.data) : event.data;
    if (data) client.embeddedWallet.onMessage(data);
  });
  return client;
}

async function connectUser(user) {
  currentUser = user;
  let embeddedWallet = getUserEmbeddedEthereumWallet(user);
  if (!embeddedWallet) {
    const result = await client.embeddedWallet.create({});
    currentUser = result.user;
    embeddedWallet = getUserEmbeddedEthereumWallet(currentUser);
  }
  if (!embeddedWallet) throw new Error('Your Privy wallet could not be created.');
  const entropy = getEntropyDetailsFromUser(currentUser, embeddedWallet);
  const provider = await client.embeddedWallet.getEthereumProvider({ wallet: embeddedWallet, entropyId: entropy.entropyId, entropyIdVerifier: entropy.entropyIdVerifier });
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!accounts || !accounts[0]) throw new Error('Your Privy wallet did not return an address.');
  if (typeof window.rwiUsePrivyProvider !== 'function') throw new Error('The voting wallet is not ready yet.');
  await window.rwiUsePrivyProvider(provider, accounts[0]);
  closeDialog();
}

async function start() {
  try {
    setMessage('Opening secure sign-in…');
    await initialize();
    const result = await client.user.get();
    if (result.user) { await connectUser(result.user); return; }
    openDialog('email');
    setMessage('Enter your email to use your Privy wallet.');
  } catch (error) {
    openDialog('email');
    setMessage(error && error.message ? error.message : 'Privy could not be opened. Please try again.', true);
  }
}
async function sendCode() {
  const email = document.getElementById('privyEmail')?.value.trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) { setMessage('Enter a valid email address.', true); return; }
  const button = document.getElementById('privySendCode');
  try {
    if (button) button.disabled = true;
    setMessage('Sending your secure code…');
    await initialize();
    await client.auth.email.sendCode(email);
    showStep('code');
    setMessage('A code was sent to ' + email + '.');
    document.getElementById('privyCode')?.focus();
  } catch (error) {
    setMessage(error && error.message ? error.message : 'The code could not be sent. Please try again.', true);
  } finally { if (button) button.disabled = false; }
}
async function verifyCode() {
  const email = document.getElementById('privyEmail').value.trim();
  const code = document.getElementById('privyCode').value.trim();
  if (!code) { setMessage('Enter the code from your email.', true); return; }
  const button = document.getElementById('privyVerifyCode');
  try {
    if (button) button.disabled = true;
    setMessage('Creating your secure wallet…');
    await initialize();
    const result = await client.auth.email.loginWithCode(email, code, 'login-or-sign-up', { embedded: { ethereum: { createOnLogin: 'users-without-wallets' } } });
    await connectUser(result.user);
  } catch (error) {
    setMessage(error && error.message ? error.message : 'That code did not work. Please try again.', true);
  } finally { if (button) button.disabled = false; }
}

window.rwiOpenPrivyWallet = start;
window.rwiDisconnectPrivyWallet = async function () { try { if (client) await client.auth.logout(); } catch (_) {} currentUser = null; };

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('privyBtn')?.addEventListener('click', start);
  document.getElementById('privyClose')?.addEventListener('click', closeDialog);
  document.getElementById('privySendCode')?.addEventListener('click', sendCode);
  document.getElementById('privyVerifyCode')?.addEventListener('click', verifyCode);
  document.getElementById('privyBack')?.addEventListener('click', () => { showStep('email'); setMessage(''); });
  document.getElementById('privyModal')?.addEventListener('click', (event) => { if (event.target.id === 'privyModal') closeDialog(); });
});

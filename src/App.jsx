// ============================================================
//  DIÁRIO DO AUTOCONHECIMENTO — com Firebase integrado
//  Firebase: Authentication (email/senha + Google) + Firestore
// ============================================================

import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  updateProfile,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  where,
} from "firebase/firestore";

// ─── FIREBASE CONFIG ──────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBufo7aMJO7tpNtA0fMT40O8pFeoOyMyQc",
  authDomain: "diario-do-autoconhecimento.firebaseapp.com",
  projectId: "diario-do-autoconhecimento",
  storageBucket: "diario-do-autoconhecimento.firebasestorage.app",
  messagingSenderId: "168307049348",
  appId: "1:168307049348:web:ea47784183e522a4ee13d1",
  measurementId: "G-B1KP6VWSYD",
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();

// Persistência de sessão: o usuário fica logado mesmo após fechar o navegador
setPersistence(auth, browserLocalPersistence).catch(console.error);

// ─── FIREBASE SERVICE LAYER ───────────────────────────────────────────────────
const FirebaseService = {
  // ── Diário ──────────────────────────────────────────────────────────────────
  async saveEntry(uid, entry) {
    const ref = doc(db, "users", uid, "entries", String(entry.id));
    await setDoc(ref, {
      ...entry,
      updatedAt: serverTimestamp(),
      createdAt: entry.createdAt || serverTimestamp(),
    });
  },
  async deleteEntry(uid, entryId) {
    await deleteDoc(doc(db, "users", uid, "entries", String(entryId)));
  },
  subscribeEntries(uid, callback) {
    const q = query(
      collection(db, "users", uid, "entries"),
      orderBy("date", "desc")
    );
    return onSnapshot(q, (snap) => {
      const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(entries);
    });
  },

  // ── Conversas ───────────────────────────────────────────────────────────────
  async saveConversation(uid, entryId, messages) {
    const ref = doc(db, "users", uid, "conversations", String(entryId));
    await setDoc(ref, {
      entryId,
      messages,
      updatedAt: serverTimestamp(),
    });
  },
  async getConversation(uid, entryId) {
    const snap = await getDoc(doc(db, "users", uid, "conversations", String(entryId)));
    return snap.exists() ? snap.data() : null;
  },

  // ── Análise (padrões, sentimentos, conexões) ─────────────────────────────────
  async saveAnalysis(uid, analysis) {
    await setDoc(doc(db, "users", uid, "analysis", "latest"), {
      ...analysis,
      updatedAt: serverTimestamp(),
    });
  },
  async getAnalysis(uid) {
    const snap = await getDoc(doc(db, "users", uid, "analysis", "latest"));
    return snap.exists() ? snap.data() : null;
  },

  // ── Afazeres ─────────────────────────────────────────────────────────────────
  async saveTodos(uid, todos) {
    await setDoc(doc(db, "users", uid, "todos", "list"), {
      items: todos,
      updatedAt: serverTimestamp(),
    });
  },
  async getTodos(uid) {
    const snap = await getDoc(doc(db, "users", uid, "todos", "list"));
    return snap.exists() ? snap.data().items : null;
  },

  // ── Configurações / Perfil ───────────────────────────────────────────────────
  async saveSettings(uid, settings) {
    await setDoc(doc(db, "users", uid, "settings", "prefs"), {
      ...settings,
      updatedAt: serverTimestamp(),
    });
  },
  async getSettings(uid) {
    const snap = await getDoc(doc(db, "users", uid, "settings", "prefs"));
    return snap.exists() ? snap.data() : null;
  },

  // ── Perfil do usuário ─────────────────────────────────────────────────────────
  async saveUserProfile(uid, profile) {
    await setDoc(
      doc(db, "users", uid, "profile", "data"),
      { ...profile, updatedAt: serverTimestamp() },
      { merge: true }
    );
  },

  // ── Bio "Quem sou eu" ─────────────────────────────────────────────────────────
  async saveBio(uid, bio) {
    await setDoc(doc(db, "users", uid, "settings", "bio"), {
      text: bio,
      updatedAt: serverTimestamp(),
    });
  },
  async getBio(uid) {
    const snap = await getDoc(doc(db, "users", uid, "settings", "bio"));
    return snap.exists() ? snap.data().text : "";
  },
};

// ─── GEMINI SERVICE ───────────────────────────────────────────────────────────
// A chave NÃO fica aqui — fica segura na Vercel como variável de ambiente.
// Todas as chamadas passam pelo proxy em /api/gemini.
const GEMINI_URL = "/api/gemini";

const SYSTEM_PERSONA = `Você é uma amiga próxima e madura — alguém que ouve de verdade, que se importa genuinamente, e que fala com calma e carinho.
Não é terapeuta nem conselheira. É uma presença humana e acolhedora.

COMO AGIR:
- Alterne naturalmente entre ouvir, validar, compartilhar uma observação genuína e, quando fizer sentido, fazer UMA pergunta reflexiva.
- Não faça pergunta toda vez — às vezes só reconheça o que a pessoa sente, com palavras simples e verdadeiras.
- Quando a pessoa desabafar, primeiro acolha o sentimento antes de qualquer coisa.
- Deixe a pessoa chegar às próprias conclusões — não diga o que ela deve fazer, mas ajude-a a enxergar por conta própria.
- Fale como gente, não como IA. Sem listas, sem tópicos, sem formalidades.
- Máximo 3 frases por resposta. Seja direta e humana.
- Nunca diagnostique. Nunca diga "você tem ansiedade" ou similares.
- Nada de frases motivacionais genéricas ou entusiasmo artificial.
- Se o usuário demonstrar sofrimento intenso, acolha com cuidado e sugira gentilmente buscar apoio profissional.
- Fale sempre em português.

TOM: próximo, real, como uma conversa entre amigas de confiança.`;

const ANALYSIS_PROMPT = (entries) =>
  `Você é um analisador emocional. Analise as entradas do diário abaixo e retorne APENAS um JSON válido, sem markdown, sem texto adicional, sem explicações.

ENTRADAS DO DIÁRIO:
${entries.map((e, i) => `[${e.date}]: "${e.text}" | Emoções declaradas: ${e.emotions?.join(", ")}`).join("\n")}

Retorne exatamente este JSON (sem nenhum texto antes ou depois):
{
  "patterns": [
    { "label": "string curto", "intensity": number_0_to_100, "desc": "1 frase reflexiva e observacional" }
  ],
  "feelings": [
    { "word": "emoção em português", "freq": number_1_to_15 }
  ],
  "nodes": [
    { "id": "string_sem_espacos", "label": "string curto", "x": number_0_to_100, "y": number_0_to_100 }
  ],
  "edges": [
    ["id_origem", "id_destino"]
  ],
  "summary": "1-2 frases reflexivas sobre o estado emocional geral"
}

REGRAS OBRIGATÓRIAS:
- patterns: 3 a 6 padrões emocionais/comportamentais reais percebidos nas entradas
- feelings: 6 a 14 emoções REAIS detectadas no texto (ex: "tristeza", "ansiedade", "gratidão", "saudade") com frequência estimada
- nodes: 5 a 9 nós representando emoções ou temas centrais presentes no diário
- edges: conexões causais ou relacionais entre os nós
- Base tudo APENAS no que está escrito nas entradas — nunca invente emoções não presentes
- Linguagem observacional, nunca diagnóstica
- O JSON deve ser 100% válido e parseável`;

async function callGemini(prompt, systemContext = "") {
  const fullPrompt = systemContext ? `${systemContext}\n\n${prompt}` : prompt;
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 2048, topP: 0.9 },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callGeminiChat(systemPrompt, history, userMessage) {
  // Embed system prompt into the first user message for maximum API compatibility
  const systemPrefix = `[INSTRUÇÕES DO SISTEMA - siga sempre]
${systemPrompt}

[MENSAGEM DO USUÁRIO]
`;

  const rawContents = [
    ...history.map((m) => ({
      role: m.role === "ai" ? "model" : "user",
      parts: [{ text: m.text }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  // Merge consecutive messages from the same role
  const contents = rawContents.reduce((acc, msg) => {
    if (acc.length > 0 && acc[acc.length - 1].role === msg.role) {
      acc[acc.length - 1].parts.push(...msg.parts);
    } else {
      acc.push({ ...msg, parts: [...msg.parts] });
    }
    return acc;
  }, []);

  // Prepend system prompt to first user message
  if (contents[0]?.role === "user") {
    contents[0].parts[0].text = systemPrefix + contents[0].parts[0].text;
  } else {
    contents.unshift({ role: "user", parts: [{ text: systemPrefix + "." }] });
  }

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.85, maxOutputTokens: 2048, topP: 0.92 },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      ],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error("Gemini chat error body:", errBody);
    throw new Error(`Gemini chat error: ${res.status}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function analyzeEntries(entries) {
  if (!entries.length) return null;
  const raw = await callGemini(ANALYSIS_PROMPT(entries));
  const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(clean);
}

// ─── DEFAULT DATA ─────────────────────────────────────────────────────────────
// Sem dados padrão — o usuário começa com tudo zerado
const FALLBACK_RESPONSES = [
  "O que você acha que está por trás desse sentimento?",
  "Esse sentimento parece familiar para você?",
  "Existe alguma parte dessa situação que você ainda não olhou com atenção?",
  "Quando você se lembra de ter sentido isso antes, o que estava acontecendo na sua vida?",
  "Como seu corpo reagiu quando isso aconteceu?",
];

// ─── AUTH CONTEXT ─────────────────────────────────────────────────────────────
const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return unsub;
  }, []);

  const login = async (email, password) => {
    setAuthError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      setAuthError(translateAuthError(e.code));
      throw e;
    }
  };

  const signup = async (email, password, name) => {
    setAuthError("");
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(cred.user, { displayName: name });
      await FirebaseService.saveUserProfile(cred.user.uid, { name, email, createdAt: new Date().toISOString() });
    } catch (e) {
      setAuthError(translateAuthError(e.code));
      throw e;
    }
  };

  const loginWithGoogle = async () => {
    setAuthError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await FirebaseService.saveUserProfile(result.user.uid, {
        name: result.user.displayName,
        email: result.user.email,
        photoURL: result.user.photoURL,
      });
    } catch (e) {
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
        setAuthError(translateAuthError(e.code));
      }
    }
  };

  const logout = () => signOut(auth);

  const resetPassword = async (email) => {
    await sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider value={{ user, authError, setAuthError, login, signup, loginWithGoogle, logout, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  return useContext(AuthContext);
}

function translateAuthError(code) {
  const map = {
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/email-already-in-use": "Este e-mail já está em uso.",
    "auth/weak-password": "Senha deve ter ao menos 6 caracteres.",
    "auth/too-many-requests": "Muitas tentativas. Tente novamente mais tarde.",
    "auth/network-request-failed": "Erro de rede. Verifique sua conexão.",
    "auth/invalid-credential": "Credenciais inválidas. Verifique e-mail e senha.",
  };
  return map[code] || "Erro inesperado. Tente novamente.";
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function formatDate(str) {
  const d = new Date(str + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}

// ─── ICONS ───────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 20, style = {} }) => {
  const icons = {
    home: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    book: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
    chart: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    network: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
    cloud: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><polyline points="20 6 9 17 4 12"/></svg>,
    settings: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    sun: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
    moon: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
    send: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    user: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    x: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    feather: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>,
    sparkle: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 3l.75 2.25L22 6l-2.25.75L19 9l-.75-2.25L16 6l2.25-.75z"/><path d="M5 15l.75 2.25L8 18l-2.25.75L5 21l-.75-2.25L2 18l2.25-.75z"/></svg>,
    refresh: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
    trash: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
    google: <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style}><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>,
    logout: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
    save: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>,
    edit: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    cloud_sync: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><polyline points="16 14 12 10 8 14"/><line x1="12" y1="10" x2="12" y2="20"/></svg>,
  };
  return icons[name] || null;
};

// ─── LOADING COMPONENTS ───────────────────────────────────────────────────────
function Dots({ dark }) {
  return (
    <div style={{ display: "flex", gap: 4, padding: "12px 0", paddingLeft: 4 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: "50%",
          background: dark ? "#4b5563" : "#d1d5db",
          animation: `pulse 1.2s ease ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

function SkeletonCard({ dark }) {
  return (
    <div style={{
      padding: "24px 28px", borderRadius: 16,
      background: dark ? "rgba(255,255,255,0.02)" : "#fff",
      border: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}`,
    }}>
      <div style={{ height: 10, width: "30%", borderRadius: 6, background: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)", marginBottom: 14, animation: "pulse 1.5s ease infinite" }} />
      <div style={{ height: 10, width: "90%", borderRadius: 6, background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", marginBottom: 8, animation: "pulse 1.5s ease 0.1s infinite" }} />
      <div style={{ height: 10, width: "75%", borderRadius: 6, background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", marginBottom: 8, animation: "pulse 1.5s ease 0.2s infinite" }} />
      <div style={{ height: 10, width: "55%", borderRadius: 6, background: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)", animation: "pulse 1.5s ease 0.3s infinite" }} />
    </div>
  );
}

function SaveIndicator({ status, dark }) {
  if (!status) return null;
  const config = {
    saving: { text: "Salvando...", color: "#f59e0b", icon: "save" },
    saved: { text: "Salvo", color: "#10b981", icon: "check" },
    error: { text: "Erro ao salvar", color: "#ef4444", icon: "x" },
  };
  const c = config[status];
  if (!c) return null;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 12px", borderRadius: 100,
      background: `${c.color}18`,
      border: `1px solid ${c.color}30`,
      fontSize: 11, color: c.color, letterSpacing: "0.04em",
      transition: "all 0.3s",
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: c.color,
        animation: status === "saving" ? "pulse 1s ease infinite" : "none",
      }} />
      {c.text}
    </div>
  );
}

function AIBadge({ dark, analyzing }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 12px",
      background: analyzing
        ? (dark ? "rgba(251,191,36,0.1)" : "rgba(251,191,36,0.08)")
        : (dark ? "rgba(99,102,241,0.1)" : "rgba(99,102,241,0.08)"),
      borderRadius: 100,
      border: `1px solid ${analyzing
        ? (dark ? "rgba(251,191,36,0.2)" : "rgba(251,191,36,0.15)")
        : (dark ? "rgba(99,102,241,0.2)" : "rgba(99,102,241,0.12)")}`,
      fontSize: 11,
      color: analyzing ? "#f59e0b" : (dark ? "#818cf8" : "#6366f1"),
      letterSpacing: "0.04em",
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: analyzing ? "#f59e0b" : "#6366f1",
        animation: analyzing ? "pulse 1s ease infinite" : "none",
      }} />
      {analyzing ? "IA analisando..." : "Gemini ativo"}
    </div>
  );
}

// ─── AUTH PAGES ───────────────────────────────────────────────────────────────
function AuthPage({ dark }) {
  const { login, signup, loginWithGoogle, resetPassword, authError, setAuthError } = useAuth();
  const [mode, setMode] = useState("login"); // login | signup | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");

  const switchMode = (m) => {
    setMode(m);
    setAuthError("");
    setSuccess("");
  };

  const handleSubmit = async () => {
    setLoading(true);
    setSuccess("");
    try {
      if (mode === "login") {
        await login(email, password);
      } else if (mode === "signup") {
        await signup(email, password, name);
      } else {
        await resetPassword(email);
        setSuccess("E-mail de recuperação enviado! Verifique sua caixa de entrada.");
      }
    } catch {}
    setLoading(false);
  };

  const handleGoogle = async () => {
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch {}
    setLoading(false);
  };

  const inputStyle = {
    width: "100%", border: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
    outline: "none", background: dark ? "rgba(255,255,255,0.03)" : "#faf9f7",
    borderRadius: 12, padding: "12px 16px", fontSize: 14,
    color: dark ? "#d1cdc8" : "#3d3530", boxSizing: "border-box",
    fontFamily: "'Lato', sans-serif",
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{
        width: "100%", maxWidth: 400,
        background: dark ? "#0f1520" : "#fff",
        borderRadius: 24,
        border: `1px solid ${dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)"}`,
        padding: "40px 36px",
        boxShadow: dark ? "0 32px 80px rgba(0,0,0,0.5)" : "0 32px 80px rgba(0,0,0,0.1)",
        animation: "slideUp 0.4s ease",
      }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 13, color: dark ? "#818cf8" : "#7c3aed", fontStyle: "italic", marginBottom: 6 }}>
            Diário do
          </div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 22, color: dark ? "#e8e4df" : "#1a1714", marginBottom: 8 }}>
            {mode === "login" ? "Bem-vindo de volta" : mode === "signup" ? "Criar conta" : "Recuperar senha"}
          </div>
          <div style={{ fontSize: 13, color: dark ? "#6b7280" : "#9ca3af", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
            {mode === "login" ? "Entre para acessar seu diário." : mode === "signup" ? "Comece sua jornada de autoconhecimento." : "Informe seu e-mail para recuperar o acesso."}
          </div>
        </div>

        {/* Google Login */}
        {mode !== "reset" && (
          <button onClick={handleGoogle} disabled={loading} style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            background: dark ? "rgba(255,255,255,0.04)" : "#fff",
            border: `1px solid ${dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
            borderRadius: 12, padding: "11px", fontSize: 14, cursor: "pointer",
            color: dark ? "#d1cdc8" : "#3d3530", marginBottom: 20, fontFamily: "'Lato', sans-serif",
            transition: "background 0.2s",
          }}>
            <Icon name="google" size={18} />
            Continuar com Google
          </button>
        )}

        {mode !== "reset" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <div style={{ flex: 1, height: 1, background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }} />
            <span style={{ fontSize: 12, color: dark ? "#4b5563" : "#c4b8ae" }}>ou</span>
            <div style={{ flex: 1, height: 1, background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }} />
          </div>
        )}

        {mode === "signup" && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: dark ? "#6b7280" : "#9ca3af", marginBottom: 6 }}>Nome</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" style={inputStyle} />
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: dark ? "#6b7280" : "#9ca3af", marginBottom: 6 }}>E-mail</div>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            style={inputStyle} />
        </div>

        {mode !== "reset" && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: dark ? "#6b7280" : "#9ca3af", marginBottom: 6 }}>Senha</div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              style={inputStyle} />
          </div>
        )}

        {authError && (
          <div style={{
            padding: "10px 14px", borderRadius: 10, marginBottom: 16,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            fontSize: 13, color: "#ef4444",
          }}>{authError}</div>
        )}

        {success && (
          <div style={{
            padding: "10px 14px", borderRadius: 10, marginBottom: 16,
            background: "rgba(16,185,129,0.08)",
            border: "1px solid rgba(16,185,129,0.2)",
            fontSize: 13, color: "#10b981",
          }}>{success}</div>
        )}

        <button onClick={handleSubmit} disabled={loading} style={{
          width: "100%", background: loading ? "rgba(99,102,241,0.5)" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
          color: "#fff", border: "none", borderRadius: 12, padding: "13px",
          fontSize: 15, cursor: loading ? "not-allowed" : "pointer", fontWeight: 500,
          boxShadow: "0 4px 20px rgba(99,102,241,0.3)", fontFamily: "'Lato', sans-serif",
          transition: "all 0.2s",
        }}>
          {loading ? "Aguarde..." : mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Enviar e-mail"}
        </button>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: dark ? "#6b7280" : "#9ca3af" }}>
          {mode === "login" && (
            <>
              <button onClick={() => switchMode("reset")} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#818cf8" : "#6366f1", fontSize: 13, fontFamily: "'Lato', sans-serif" }}>
                Esqueceu a senha?
              </button>
              <span style={{ margin: "0 8px" }}>·</span>
              <button onClick={() => switchMode("signup")} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#818cf8" : "#6366f1", fontSize: 13, fontFamily: "'Lato', sans-serif" }}>
                Criar conta
              </button>
            </>
          )}
          {mode === "signup" && (
            <button onClick={() => switchMode("login")} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#818cf8" : "#6366f1", fontSize: 13, fontFamily: "'Lato', sans-serif" }}>
              Já tenho conta
            </button>
          )}
          {mode === "reset" && (
            <button onClick={() => switchMode("login")} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#818cf8" : "#6366f1", fontSize: 13, fontFamily: "'Lato', sans-serif" }}>
              Voltar ao login
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CHAT MODAL (com save no Firebase) ────────────────────────────────────────
function ChatModal({ entry, onClose, dark, userBio = "" }) {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState([
    { role: "ai", text: `Li o que você escreveu sobre ${formatDate(entry.date)}. O que mais ficou presente para você nesse dia?` }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const bottomRef = useRef(null);
  const saveTimer = useRef(null);

  // Carrega conversa salva
  useEffect(() => {
    if (!user) return;
    FirebaseService.getConversation(user.uid, entry.id).then((conv) => {
      if (conv?.messages?.length) setMsgs(conv.messages);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const saveConversation = useCallback(async (messages) => {
    if (!user) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await FirebaseService.saveConversation(user.uid, entry.id, messages);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(null), 2000);
      } catch {
        setSaveStatus("error");
      }
    }, 1000);
  }, [user, entry.id]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    const newMsgs = [...msgs, { role: "user", text: userMsg }];
    setMsgs(newMsgs);
    setLoading(true);

    const bioContext = userBio ? `\n\nHISTÓRIA DE VIDA DA PESSOA (use para entender melhor, não mencione explicitamente):\n${userBio}` : "";

    const systemPrompt = `${SYSTEM_PERSONA}${bioContext}

CONTEXTO DA ENTRADA DO DIÁRIO:
Data: ${entry.date}
Texto: "${entry.text}"
Emoções detectadas: ${entry.emotions?.join(", ")}

Use esse contexto para entender o momento emocional da pessoa. Responda como uma amiga que conhece esse contexto, mas de forma natural — não repita o que ela escreveu, apenas deixe isso guiar sua empatia.`;

    try {
      const text = await callGeminiChat(systemPrompt, msgs, userMsg);
      const finalMsgs = [...newMsgs, { role: "ai", text: text || "Não consegui gerar uma resposta. Tente novamente." }];
      setMsgs(finalMsgs);
      saveConversation(finalMsgs);
    } catch (err) {
      console.error("Gemini chat failed:", err);
      const fallMsgs = [...newMsgs, { role: "ai", text: "Desculpe, não consegui me conectar agora. Verifique sua conexão e tente novamente." }];
      setMsgs(fallMsgs);
      saveConversation(fallMsgs);
    }
    setLoading(false);
  };

  const bc = dark ? "rgba(8,12,20,0.9)" : "rgba(245,243,240,0.9)";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: bc, backdropFilter: "blur(16px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px", animation: "fadeIn 0.25s ease",
    }}>
      <div style={{
        width: "100%", maxWidth: 560,
        background: dark ? "#0f1520" : "#faf9f7",
        borderRadius: 20,
        border: `1px solid ${dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)"}`,
        display: "flex", flexDirection: "column",
        maxHeight: "82vh", overflow: "hidden",
        boxShadow: dark ? "0 40px 100px rgba(0,0,0,0.7)" : "0 40px 100px rgba(0,0,0,0.14)",
      }}>
        <div style={{
          padding: "20px 24px",
          borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: dark ? "#e8e4df" : "#1a1714", fontFamily: "Georgia, serif" }}>
              Conversa reflexiva
            </div>
            <div style={{ fontSize: 12, color: dark ? "#6b7280" : "#9ca3af", marginTop: 2 }}>
              {formatDate(entry.date)}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SaveIndicator status={saveStatus} dark={dark} />
            <AIBadge dark={dark} analyzing={loading} />
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#6b7280" : "#9ca3af", padding: 4 }}>
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", animation: "slideUp 0.3s ease" }}>
              <div style={{
                maxWidth: "78%", padding: "12px 16px",
                borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                background: m.role === "user"
                  ? (dark ? "rgba(99,102,241,0.2)" : "rgba(99,102,241,0.1)")
                  : (dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"),
                fontSize: 14, lineHeight: 1.7,
                color: dark ? "#d1cdc8" : "#3d3530",
                fontFamily: m.role === "ai" ? "Georgia, serif" : "inherit",
              }}>
                {m.text}
              </div>
            </div>
          ))}
          {loading && <Dots dark={dark} />}
          <div ref={bottomRef} />
        </div>

        <div style={{
          padding: "16px 20px",
          borderTop: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}`,
          display: "flex", gap: 10, alignItems: "flex-end",
        }}>
          <textarea
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Escreva sua resposta..." rows={1}
            style={{ flex: 1, border: "none", outline: "none", resize: "none", background: "transparent", fontSize: 14, lineHeight: 1.6, color: dark ? "#d1cdc8" : "#3d3530", fontFamily: "inherit" }}
          />
          <button onClick={send} disabled={loading} style={{
            background: loading ? (dark ? "rgba(99,102,241,0.1)" : "rgba(99,102,241,0.06)") : (dark ? "rgba(99,102,241,0.3)" : "rgba(99,102,241,0.15)"),
            border: "none", borderRadius: 10, padding: "8px 10px",
            cursor: loading ? "not-allowed" : "pointer", color: "#6366f1", flexShrink: 0,
          }}>
            <Icon name="send" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── NEW ENTRY MODAL ──────────────────────────────────────────────────────────
function NewEntryModal({ onClose, onSave, dark }) {
  const [text, setText] = useState("");
  const [emotions, setEmotions] = useState("");
  const [aiDetecting, setAiDetecting] = useState(false);

  const detectEmotions = async () => {
    if (!text.trim()) return;
    setAiDetecting(true);
    try {
      const raw = await callGemini(
        `Analise o texto abaixo e identifique as 3-5 principais emoções presentes. Retorne APENAS as emoções separadas por vírgula, em português, em letras minúsculas, sem ponto final.

Texto: "${text}"`, ""
      );
      setEmotions(raw.trim().replace(/\.$/, ""));
    } catch {}
    setAiDetecting(false);
  };

  const save = () => {
    if (!text.trim()) return;
    onSave({
      id: Date.now(),
      date: new Date().toISOString().split("T")[0],
      text: text.trim(),
      emotions: emotions.split(",").map((e) => e.trim()).filter(Boolean),
      createdAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: dark ? "rgba(8,12,20,0.9)" : "rgba(245,243,240,0.9)",
      backdropFilter: "blur(16px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px", animation: "fadeIn 0.25s ease",
    }}>
      <div style={{
        width: "100%", maxWidth: 600,
        background: dark ? "#0f1520" : "#faf9f7",
        borderRadius: 20,
        border: `1px solid ${dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)"}`,
        padding: "32px",
        boxShadow: dark ? "0 40px 100px rgba(0,0,0,0.7)" : "0 40px 100px rgba(0,0,0,0.14)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: dark ? "#e8e4df" : "#1a1714" }}>Nova entrada</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#6b7280" : "#9ca3af" }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ fontSize: 12, color: dark ? "#4b5563" : "#9ca3af", marginBottom: 6, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          {formatDate(new Date().toISOString().split("T")[0])}
        </div>

        <textarea
          value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Como foi seu dia? O que você está sentindo?" rows={8}
          style={{
            width: "100%", border: "none", outline: "none",
            background: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
            borderRadius: 12, padding: "16px", fontSize: 15, lineHeight: 1.8,
            color: dark ? "#d1cdc8" : "#3d3530",
            resize: "none", fontFamily: "Georgia, serif", boxSizing: "border-box",
          }}
        />

        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: dark ? "#6b7280" : "#9ca3af" }}>Emoções (separadas por vírgula)</div>
            <button onClick={detectEmotions} disabled={!text.trim() || aiDetecting} style={{
              background: "none", border: "none", cursor: text.trim() ? "pointer" : "not-allowed",
              color: dark ? "#818cf8" : "#6366f1", fontSize: 11,
              display: "flex", alignItems: "center", gap: 4,
              opacity: !text.trim() ? 0.4 : 1, padding: "2px 6px",
            }}>
              <Icon name="sparkle" size={12} />
              {aiDetecting ? "Detectando..." : "Detectar com IA"}
            </button>
          </div>
          <input
            value={emotions} onChange={(e) => setEmotions(e.target.value)}
            placeholder="ex: ansiedade, leveza, confusão"
            style={{
              width: "100%",
              border: `1px solid ${dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)"}`,
              outline: "none", background: "transparent", borderRadius: 10,
              padding: "10px 14px", fontSize: 14,
              color: dark ? "#d1cdc8" : "#3d3530", boxSizing: "border-box",
              fontFamily: "'Lato', sans-serif",
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
          <button onClick={onClose} style={{
            background: "none", border: `1px solid ${dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
            borderRadius: 10, padding: "10px 20px", fontSize: 14,
            cursor: "pointer", color: dark ? "#6b7280" : "#9ca3af", fontFamily: "'Lato', sans-serif",
          }}>Cancelar</button>
          <button onClick={save} style={{
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14,
            cursor: "pointer", color: "#fff", fontWeight: 500, fontFamily: "'Lato', sans-serif",
          }}>Salvar</button>
        </div>
      </div>
    </div>
  );
}

// ─── HOME PAGE ────────────────────────────────────────────────────────────────
function HomePage({ dark, setPage }) {
  const { user } = useAuth();
  const firstName = user?.displayName?.split(" ")[0] || "você";
  const features = [
    { icon: "book", title: "Escrita do diário", desc: "Um espaço tranquilo para registrar seus dias e sentimentos com profundidade." },
    { icon: "chart", title: "Padrões emocionais", desc: "Descubra ciclos que se repetem e o que eles revelam sobre você." },
    { icon: "network", title: "Linha de pensamento", desc: "Visualize como suas emoções se conectam e se influenciam." },
    { icon: "cloud", title: "Nuvem de sentimentos", desc: "Veja o mapa visual das emoções mais presentes na sua vida." },
    { icon: "feather", title: "IA reflexiva", desc: "Uma conversa sem julgamentos para pensar mais fundo sobre si mesmo." },
  ];

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "60px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 80 }}>
        <div style={{
          display: "inline-block", fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase",
          color: dark ? "#6366f1" : "#8b5cf6", marginBottom: 24,
          padding: "6px 16px", background: dark ? "rgba(99,102,241,0.1)" : "rgba(139,92,246,0.08)", borderRadius: 100,
        }}>
          Olá, {firstName}
        </div>

        <h1 style={{
          fontFamily: "Georgia, serif", fontSize: "clamp(36px, 6vw, 64px)", fontWeight: 400,
          lineHeight: 1.2, color: dark ? "#e8e4df" : "#1a1714", margin: "0 0 24px", letterSpacing: "-0.02em",
        }}>
          Diário do<br />
          <span style={{ color: dark ? "#818cf8" : "#7c3aed", fontStyle: "italic" }}>Autoconhecimento</span>
        </h1>

        <p style={{ fontSize: 18, lineHeight: 1.8, color: dark ? "#6b7280" : "#6b6460", maxWidth: 480, margin: "0 auto 40px", fontFamily: "Georgia, serif" }}>
          Um espaço para entender melhor seus pensamentos, emoções e padrões — com o apoio da inteligência artificial Gemini.
        </p>

        <button onClick={() => setPage("diary")} style={{
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          color: "#fff", border: "none", borderRadius: 14,
          padding: "14px 32px", fontSize: 15, fontWeight: 500,
          cursor: "pointer", letterSpacing: "0.02em",
          boxShadow: "0 8px 32px rgba(99,102,241,0.3)", transition: "transform 0.2s, box-shadow 0.2s",
          fontFamily: "'Lato', sans-serif",
        }}
          onMouseEnter={(e) => { e.target.style.transform = "translateY(-2px)"; e.target.style.boxShadow = "0 12px 40px rgba(99,102,241,0.4)"; }}
          onMouseLeave={(e) => { e.target.style.transform = "translateY(0)"; e.target.style.boxShadow = "0 8px 32px rgba(99,102,241,0.3)"; }}
        >
          Começar a escrever
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        {features.map((f, i) => (
          <div key={i} style={{
            padding: "28px 24px",
            background: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
            borderRadius: 16, border: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}`,
            transition: "transform 0.2s, border-color 0.2s", cursor: "default",
            animation: `slideUp 0.5s ease ${i * 0.08}s both`,
          }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.borderColor = dark ? "rgba(99,102,241,0.2)" : "rgba(99,102,241,0.15)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"; }}
          >
            <div style={{ color: dark ? "#818cf8" : "#7c3aed", marginBottom: 14 }}>
              <Icon name={f.icon} size={22} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: dark ? "#d1cdc8" : "#1a1714", marginBottom: 8 }}>{f.title}</div>
            <div style={{ fontSize: 13, lineHeight: 1.65, color: dark ? "#6b7280" : "#9ca3af" }}>{f.desc}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 80, textAlign: "center", padding: "40px", borderTop: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}` }}>
        <p style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 18, lineHeight: 1.8, color: dark ? "#4b5563" : "#c4b8ae", maxWidth: 460, margin: "0 auto" }}>
          "Conhecer-se é a sabedoria mais difícil<br />e a mais necessária."
        </p>
      </div>
    </div>
  );
}

// ─── DIARY PAGE ───────────────────────────────────────────────────────────────
function DiaryPage({ dark, entries, setEntries, onAnalyze, loading, userBio = "" }) {
  const { user } = useAuth();
  const [chat, setChat] = useState(null);
  const [newModal, setNewModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const saveEntry = async (entry) => {
    setSaveStatus("saving");
    try {
      await FirebaseService.saveEntry(user.uid, entry);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(null), 2000);
      // Usa as entradas atuais + nova entrada para análise imediata
      const updatedEntries = [entry, ...entries.filter(e => String(e.id) !== String(entry.id))];
      setTimeout(() => onAnalyze(updatedEntries), 800);
    } catch {
      setSaveStatus("error");
    }
  };

  const deleteEntry = async (id) => {
    if (!window.confirm("Excluir esta entrada?")) return;
    setDeletingId(id);
    try {
      await FirebaseService.deleteEntry(user.uid, id);
      if (selected?.id === id) setSelected(null);
    } catch { }
    setDeletingId(null);
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ height: 32, width: "40%", borderRadius: 8, background: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)", marginBottom: 40, animation: "pulse 1.5s ease infinite" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[1, 2, 3].map((i) => <SkeletonCard key={i} dark={dark} />)}
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px" }}>
        <button onClick={() => setSelected(null)} style={{
          background: "none", border: "none", cursor: "pointer",
          color: dark ? "#6b7280" : "#9ca3af", fontSize: 14,
          display: "flex", alignItems: "center", gap: 8, marginBottom: 32,
          fontFamily: "'Lato', sans-serif",
        }}>← Voltar</button>
        <div style={{ fontSize: 12, color: dark ? "#6b7280" : "#9ca3af", marginBottom: 8, textTransform: "capitalize" }}>
          {formatDate(selected.date)}
        </div>
        <div style={{ fontSize: 16, lineHeight: 1.9, color: dark ? "#d1cdc8" : "#3d3530", fontFamily: "Georgia, serif", marginBottom: 32, whiteSpace: "pre-wrap" }}>
          {selected.text}
        </div>
        {selected.emotions?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 32 }}>
            {selected.emotions.map((e, i) => (
              <span key={i} style={{ padding: "4px 12px", borderRadius: 100, background: dark ? "rgba(99,102,241,0.1)" : "rgba(99,102,241,0.08)", color: dark ? "#818cf8" : "#7c3aed", fontSize: 12 }}>{e}</span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button onClick={() => setChat(selected)} style={{
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            color: "#fff", border: "none", borderRadius: 12,
            padding: "12px 24px", fontSize: 14, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 8, fontFamily: "'Lato', sans-serif",
          }}>
            <Icon name="feather" size={16} />
            Conversar sobre meu dia
          </button>
          <button onClick={() => deleteEntry(selected.id)} disabled={deletingId === selected.id} style={{
            background: "none", border: `1px solid rgba(239,68,68,0.2)`,
            color: "#ef4444", borderRadius: 12, padding: "12px 24px",
            fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
            fontFamily: "'Lato', sans-serif",
          }}>
            <Icon name="trash" size={16} />
            {deletingId === selected.id ? "Excluindo..." : "Excluir"}
          </button>
        </div>
        {chat && <ChatModal entry={chat} onClose={() => setChat(null)} dark={dark} userBio={userBio} />}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 40 }}>
        <div>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 400, color: dark ? "#e8e4df" : "#1a1714", margin: 0 }}>
            Meu diário
          </h2>
          <p style={{ fontSize: 13, color: dark ? "#6b7280" : "#9ca3af", margin: "6px 0 0", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
            {entries.length} entrada{entries.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <SaveIndicator status={saveStatus} dark={dark} />
          <button onClick={() => setNewModal(true)} style={{
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            color: "#fff", border: "none", borderRadius: 12,
            padding: "10px 18px", fontSize: 13, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6, fontFamily: "'Lato', sans-serif",
          }}>
            <Icon name="plus" size={16} /> Nova entrada
          </button>
        </div>
      </div>

      {entries.length === 0 && (
        <div style={{
          textAlign: "center", padding: "60px 24px",
          color: dark ? "#4b5563" : "#c4b8ae",
          fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 16, lineHeight: 1.8,
        }}>
          Nenhuma entrada ainda.<br />Comece escrevendo sobre seu dia.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {entries.map((entry, i) => (
          <div key={entry.id} onClick={() => setSelected(entry)} style={{
            padding: "24px 28px", borderRadius: 16,
            background: dark ? "rgba(255,255,255,0.02)" : "#fff",
            border: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}`,
            cursor: "pointer", transition: "transform 0.2s, border-color 0.2s, box-shadow 0.2s",
            animation: `slideUp 0.4s ease ${i * 0.06}s both`,
          }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = dark ? "rgba(99,102,241,0.2)" : "rgba(99,102,241,0.15)"; e.currentTarget.style.boxShadow = dark ? "0 8px 32px rgba(0,0,0,0.3)" : "0 8px 32px rgba(0,0,0,0.08)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"; e.currentTarget.style.boxShadow = "none"; }}
          >
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: dark ? "#6b7280" : "#9ca3af", marginBottom: 12 }}>
              {formatDate(entry.date)}
            </div>
            <p style={{
              fontSize: 15, lineHeight: 1.75, color: dark ? "#9ca3af" : "#4a4540",
              margin: "0 0 16px", fontFamily: "Georgia, serif",
              display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>{entry.text}</p>
            {entry.emotions?.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {entry.emotions.map((e, j) => (
                  <span key={j} style={{ padding: "3px 10px", borderRadius: 100, background: dark ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.06)", color: dark ? "#818cf8" : "#7c3aed", fontSize: 11 }}>{e}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {newModal && <NewEntryModal onClose={() => setNewModal(false)} onSave={saveEntry} dark={dark} />}
      {chat && <ChatModal entry={chat} onClose={() => setChat(null)} dark={dark} userBio={userBio} />}
    </div>
  );
}

// ─── PATTERNS PAGE ────────────────────────────────────────────────────────────
function PatternsPage({ dark, patterns, analyzing, onRefresh }) {
  const list = patterns?.length ? patterns : [];
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 400, color: dark ? "#e8e4df" : "#1a1714", margin: 0 }}>Padrões</h2>
          <p style={{ fontSize: 14, color: dark ? "#6b7280" : "#9ca3af", margin: "6px 0 0", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
            O que suas entradas revelam sobre você.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 4 }}>
          <AIBadge dark={dark} analyzing={analyzing} />
          <button onClick={onRefresh} disabled={analyzing} style={{
            background: "none", border: "none", cursor: analyzing ? "not-allowed" : "pointer",
            color: dark ? "#6b7280" : "#9ca3af", opacity: analyzing ? 0.4 : 1, padding: 4,
          }} title="Reanalisar"><Icon name="refresh" size={16} /></button>
        </div>
      </div>

      {analyzing && (
        <div style={{ padding: "16px 20px", borderRadius: 12, marginBottom: 24, background: dark ? "rgba(251,191,36,0.05)" : "rgba(251,191,36,0.04)", border: `1px solid ${dark ? "rgba(251,191,36,0.1)" : "rgba(251,191,36,0.1)"}`, fontSize: 13, color: dark ? "#d97706" : "#92400e", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
          A IA está analisando suas entradas...
        </div>
      )}

      {!analyzing && list.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 24px", color: dark ? "#4b5563" : "#c4b8ae", fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 15, lineHeight: 1.8, marginTop: 16 }}>
          Nenhum padrão identificado ainda.<br />Adicione entradas no diário para que a IA possa analisá-las.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 24 }}>
        {list.map((p, i) => (
          <div key={i} style={{ padding: "24px 28px", background: dark ? "rgba(255,255,255,0.02)" : "#fff", borderRadius: 16, border: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}`, animation: `slideUp 0.4s ease ${i * 0.07}s both` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: dark ? "#d1cdc8" : "#1a1714" }}>{p.label}</div>
              <div style={{ fontSize: 12, color: dark ? "#818cf8" : "#7c3aed", fontWeight: 500 }}>{p.intensity}%</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ height: 3, borderRadius: 100, background: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 100, background: "linear-gradient(90deg, #6366f1, #8b5cf6)", width: `${p.intensity}%`, transition: "width 1s ease" }} />
              </div>
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: dark ? "#6b7280" : "#6b6460", margin: 0, fontFamily: "Georgia, serif", fontStyle: "italic" }}>{p.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── THOUGHT LINE PAGE ────────────────────────────────────────────────────────
function ThoughtLinePage({ dark, nodes, edges, analyzing }) {
  const [hoveredNode, setHoveredNode] = useState(null);
  const displayNodes = nodes?.length ? nodes : [];
  const displayEdges = edges?.length ? edges : [];
  const nodeMap = Object.fromEntries(displayNodes.map((n) => [n.id, n]));

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 400, color: dark ? "#e8e4df" : "#1a1714", margin: 0 }}>Linha de pensamento</h2>
          <p style={{ fontSize: 14, color: dark ? "#6b7280" : "#9ca3af", margin: "6px 0 0", fontFamily: "Georgia, serif", fontStyle: "italic" }}>Como seus pensamentos e emoções se conectam.</p>
        </div>
        <AIBadge dark={dark} analyzing={analyzing} />
      </div>

      {!analyzing && displayNodes.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 24px", color: dark ? "#4b5563" : "#c4b8ae", fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 15, lineHeight: 1.8, marginTop: 16 }}>
          Nenhuma conexão identificada ainda.<br />Adicione entradas no diário para gerar sua linha de pensamento.
        </div>
      ) : (
        <>
          <div style={{ background: dark ? "rgba(255,255,255,0.01)" : "#fff", borderRadius: 20, border: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}`, padding: "40px 24px", marginTop: 24, position: "relative", overflow: "hidden" }}>
            <svg viewBox="0 0 100 100" style={{ width: "100%", height: "auto" }}>
              <defs>
                <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill={dark ? "#4b5563" : "#d1d5db"} />
                </marker>
              </defs>
              {displayEdges.map(([a, b], i) => {
                const na = nodeMap[a], nb = nodeMap[b];
                if (!na || !nb) return null;
                return (
                  <line key={i} x1={na.x} y1={na.y + 2.5} x2={nb.x} y2={nb.y - 2.5}
                    stroke={dark ? "#374151" : "#e5e7eb"} strokeWidth="0.5" markerEnd="url(#arrowhead)" />
                );
              })}
              {displayNodes.map((n) => (
                <g key={n.id} onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)} style={{ cursor: "pointer" }}>
                  <circle cx={n.x} cy={n.y} r="3.5"
                    fill={hoveredNode === n.id ? "#6366f1" : (dark ? "#1f2937" : "#f3f4f6")}
                    stroke={hoveredNode === n.id ? "#818cf8" : (dark ? "#374151" : "#d1d5db")}
                    strokeWidth="0.7" style={{ transition: "all 0.2s" }}
                  />
                  <text x={n.x + 5} y={n.y + 1} fontSize="3.2"
                    fill={hoveredNode === n.id ? (dark ? "#a5b4fc" : "#6366f1") : (dark ? "#9ca3af" : "#6b7280")}
                    style={{ fontFamily: "Georgia, serif", transition: "fill 0.2s" }}>
                    {n.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
          <div style={{ marginTop: 24, fontSize: 13, color: dark ? "#4b5563" : "#c4b8ae", textAlign: "center", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
            Passe o cursor sobre os nós para explorar.
          </div>
        </>
      )}
    </div>
  );
}

// ─── FEELINGS PAGE ────────────────────────────────────────────────────────────
function FeelingsPage({ dark, feelings, analyzing, summary }) {
  const [period, setPeriod] = useState("tudo");
  const displayFeelings = feelings?.length ? feelings : [];
  const max = displayFeelings.length ? Math.max(...displayFeelings.map((f) => f.freq)) : 1;
  const colors = dark
    ? ["#818cf8","#a78bfa","#c4b5fd","#6366f1","#7c3aed","#8b5cf6","#a5b4fc"]
    : ["#6366f1","#7c3aed","#8b5cf6","#a78bfa","#c084fc","#818cf8","#4f46e5"];

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 400, color: dark ? "#e8e4df" : "#1a1714", margin: 0 }}>Nuvem de sentimentos</h2>
          <p style={{ fontSize: 14, color: dark ? "#6b7280" : "#9ca3af", margin: "6px 0 0", fontFamily: "Georgia, serif", fontStyle: "italic" }}>As emoções mais presentes nas suas entradas.</p>
        </div>
        <AIBadge dark={dark} analyzing={analyzing} />
      </div>

      {summary && (
        <div style={{ padding: "16px 20px", borderRadius: 12, margin: "16px 0", background: dark ? "rgba(99,102,241,0.05)" : "rgba(99,102,241,0.04)", border: `1px solid ${dark ? "rgba(99,102,241,0.1)" : "rgba(99,102,241,0.08)"}`, fontSize: 14, lineHeight: 1.7, color: dark ? "#9ca3af" : "#6b6460", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
          {summary}
        </div>
      )}

      {!analyzing && displayFeelings.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 24px", color: dark ? "#4b5563" : "#c4b8ae", fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 15, lineHeight: 1.8, marginTop: 16 }}>
          Nenhum sentimento identificado ainda.<br />Adicione entradas no diário para gerar sua nuvem de sentimentos.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "center", padding: "48px 32px", background: dark ? "rgba(255,255,255,0.01)" : "#fff", borderRadius: 20, border: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}`, minHeight: 300, marginTop: 16 }}>
            {displayFeelings.map((f, i) => {
              const size = 12 + (f.freq / max) * 20;
              const opacity = 0.4 + (f.freq / max) * 0.6;
              const color = colors[i % colors.length];
              return (
                <span key={f.word} style={{ fontSize: size, color, opacity, fontFamily: "Georgia, serif", cursor: "default", transition: "opacity 0.2s, transform 0.2s", display: "inline-block", animation: `fadeIn 0.5s ease ${i * 0.06}s both`, padding: "4px 2px" }}
                  onMouseEnter={(e) => { e.target.style.opacity = 1; e.target.style.transform = "scale(1.1)"; }}
                  onMouseLeave={(e) => { e.target.style.opacity = opacity; e.target.style.transform = "scale(1)"; }}
                  title={`${f.freq} vezes`}
                >
                  {f.word}
                </span>
              );
            })}
          </div>

          <div style={{ marginTop: 24, display: "flex", justifyContent: "center", gap: 24 }}>
            {["semana", "mês", "tudo"].map((p) => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                background: period === p ? (dark ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.1)") : "none",
                border: "none", cursor: "pointer", padding: "6px 16px", fontSize: 13, borderRadius: 100,
                color: period === p ? (dark ? "#818cf8" : "#6366f1") : (dark ? "#6b7280" : "#9ca3af"),
                transition: "all 0.2s", fontFamily: "'Lato', sans-serif",
              }}>{p}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── TODO PAGE (com Firebase) ─────────────────────────────────────────────────
function TodoPage({ dark }) {
  const { user } = useAuth();
  const [todos, setTodos] = useState(null);
  const [newText, setNewText] = useState("");
  const [saveStatus, setSaveStatus] = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => {
    if (!user) return;
    FirebaseService.getTodos(user.uid).then((items) => {
      setTodos(items || []);
    });
  }, [user]);

  const persistTodos = useCallback(async (items) => {
    if (!user) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await FirebaseService.saveTodos(user.uid, items);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(null), 2000);
      } catch {
        setSaveStatus("error");
      }
    }, 800);
  }, [user]);

  const cycle = (id) => {
    const next = { pending: "progress", progress: "improved", improved: "pending" };
    const updated = todos.map((t) => t.id !== id ? t : { ...t, status: next[t.status] });
    setTodos(updated);
    persistTodos(updated);
  };

  const add = () => {
    if (!newText.trim()) return;
    const updated = [...todos, { id: Date.now(), text: newText.trim(), status: "pending" }];
    setTodos(updated);
    setNewText("");
    persistTodos(updated);
  };

  const remove = (id) => {
    const updated = todos.filter((t) => t.id !== id);
    setTodos(updated);
    persistTodos(updated);
  };

  const statusConfig = {
    pending: { label: "Pendente", color: dark ? "#6b7280" : "#9ca3af" },
    progress: { label: "Em progresso", color: "#f59e0b" },
    improved: { label: "Melhorou", color: "#10b981" },
  };

  if (todos === null) {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ height: 32, width: "30%", borderRadius: 8, background: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)", marginBottom: 40, animation: "pulse 1.5s ease infinite" }} />
        {[1, 2, 3].map((i) => <SkeletonCard key={i} dark={dark} />)}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 400, color: dark ? "#e8e4df" : "#1a1714", margin: "0 0 8px" }}>Intenções</h2>
          <p style={{ fontSize: 14, color: dark ? "#6b7280" : "#9ca3af", margin: "0 0 40px", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
            Pequenas intenções para cultivar ao longo dos dias.
          </p>
        </div>
        <SaveIndicator status={saveStatus} dark={dark} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
        {todos.map((t, i) => (
          <div key={t.id} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "18px 22px", borderRadius: 14,
            background: dark ? "rgba(255,255,255,0.02)" : "#fff",
            border: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}`,
            animation: `slideUp 0.4s ease ${i * 0.05}s both`,
            gap: 12,
          }}>
            <div style={{ fontSize: 14, color: dark ? "#d1cdc8" : "#3d3530", flex: 1 }}>{t.text}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => cycle(t.id)} style={{
                background: "none", border: `1px solid ${statusConfig[t.status].color}`,
                borderRadius: 100, padding: "4px 12px", fontSize: 11, cursor: "pointer",
                color: statusConfig[t.status].color, whiteSpace: "nowrap", transition: "all 0.2s",
                fontFamily: "'Lato', sans-serif",
              }}>
                {statusConfig[t.status].label}
              </button>
              <button onClick={() => remove(t.id)} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#374151" : "#d1d5db", padding: 4, transition: "color 0.2s" }}
                onMouseEnter={(e) => e.currentTarget.style.color = "#ef4444"}
                onMouseLeave={(e) => e.currentTarget.style.color = dark ? "#374151" : "#d1d5db"}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <input value={newText} onChange={(e) => setNewText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Adicionar intenção..."
          style={{
            flex: 1, border: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
            outline: "none", background: dark ? "rgba(255,255,255,0.03)" : "#fff",
            borderRadius: 12, padding: "12px 16px", fontSize: 14,
            color: dark ? "#d1cdc8" : "#3d3530", fontFamily: "'Lato', sans-serif",
          }}
        />
        <button onClick={add} style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", border: "none", borderRadius: 12, padding: "12px 16px", cursor: "pointer", color: "#fff" }}>
          <Icon name="plus" size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── SETTINGS PAGE (com Firebase) ─────────────────────────────────────────────
function SettingsPage({ dark, toggleDark, userBio, setUserBio }) {
  const { user, logout } = useAuth();
  const [saveStatus, setSaveStatus] = useState(null);
  const [bioText, setBioText] = useState(userBio || "");
  const [bioStatus, setBioStatus] = useState(null);

  const saveBio = async () => {
    if (!user) return;
    setBioStatus("saving");
    try {
      await FirebaseService.saveBio(user.uid, bioText);
      setUserBio(bioText);
      setBioStatus("saved");
      setTimeout(() => setBioStatus(null), 2000);
    } catch {
      setBioStatus("error");
    }
  };

  const handleToggleDark = async () => {
    toggleDark();
    if (!user) return;
    setSaveStatus("saving");
    try {
      await FirebaseService.saveSettings(user.uid, { darkMode: !dark });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(null), 2000);
    } catch {
      setSaveStatus("error");
    }
  };

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 40 }}>
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 400, color: dark ? "#e8e4df" : "#1a1714", margin: 0 }}>Configurações</h2>
        <SaveIndicator status={saveStatus} dark={dark} />
      </div>

      {/* Perfil */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: dark ? "#4b5563" : "#9ca3af", marginBottom: 12 }}>Perfil</div>
        <div style={{ background: dark ? "rgba(255,255,255,0.02)" : "#fff", borderRadius: 16, border: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}`, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 18, fontFamily: "Georgia, serif",
              overflow: "hidden",
            }}>
              {user?.photoURL
                ? <img src={user.photoURL} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="foto" />
                : (user?.displayName?.[0] || user?.email?.[0] || "?").toUpperCase()
              }
            </div>
            <div>
              <div style={{ fontSize: 15, color: dark ? "#d1cdc8" : "#1a1714" }}>{user?.displayName || "Usuário"}</div>
              <div style={{ fontSize: 12, color: dark ? "#6b7280" : "#9ca3af", marginTop: 2 }}>{user?.email}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Aparência */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: dark ? "#4b5563" : "#9ca3af", marginBottom: 12 }}>Aparência</div>
        <div style={{ background: dark ? "rgba(255,255,255,0.02)" : "#fff", borderRadius: 16, border: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}`, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px" }}>
            <div>
              <div style={{ fontSize: 14, color: dark ? "#d1cdc8" : "#1a1714" }}>Modo escuro</div>
              <div style={{ fontSize: 12, color: dark ? "#6b7280" : "#9ca3af", marginTop: 2 }}>Alterne entre tema claro e escuro</div>
            </div>
            <button onClick={handleToggleDark} style={{ width: 48, height: 26, borderRadius: 100, background: dark ? "#6366f1" : "rgba(0,0,0,0.1)", border: "none", cursor: "pointer", position: "relative", transition: "background 0.3s", flexShrink: 0 }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: dark ? 25 : 3, transition: "left 0.3s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
            </button>
          </div>
        </div>
      </div>

      {/* IA */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: dark ? "#4b5563" : "#9ca3af", marginBottom: 12 }}>Inteligência Artificial</div>
        <div style={{ background: dark ? "rgba(255,255,255,0.02)" : "#fff", borderRadius: 16, border: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}`, overflow: "hidden" }}>
          {[
            { name: "Gemini 1.5 Flash", desc: "Modelo ativo para análise emocional e conversa reflexiva" },
            { name: "Análise automática", desc: "Padrões, nuvem e conexões são gerados a cada nova entrada" },
            { name: "Sincronização em nuvem", desc: "Dados salvos e sincronizados via Firebase" },
          ].map((item, ii, arr) => (
            <div key={ii} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: ii < arr.length - 1 ? `1px solid ${dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}` : "none" }}>
              <div>
                <div style={{ fontSize: 14, color: dark ? "#d1cdc8" : "#1a1714" }}>{item.name}</div>
                <div style={{ fontSize: 12, color: dark ? "#6b7280" : "#9ca3af", marginTop: 2 }}>{item.desc}</div>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#34d399", flexShrink: 0 }} />
            </div>
          ))}
        </div>
      </div>

      {/* Quem sou eu */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: dark ? "#4b5563" : "#9ca3af" }}>Quem sou eu</div>
          <SaveIndicator status={bioStatus} dark={dark} />
        </div>
        <div style={{ background: dark ? "rgba(255,255,255,0.02)" : "#fff", borderRadius: 16, border: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}`, padding: "20px 22px" }}>
          <p style={{ fontSize: 12, color: dark ? "#6b7280" : "#9ca3af", marginBottom: 14, marginTop: 0, lineHeight: 1.6 }}>
            Conte sua história, quem você é, o que já viveu, seus valores e o que importa para você. A IA usará isso para te entender melhor nas conversas.
          </p>
          <textarea
            value={bioText}
            onChange={(e) => setBioText(e.target.value)}
            placeholder="Escreva livremente sobre quem você é..."
            rows={8}
            style={{
              width: "100%", boxSizing: "border-box",
              background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)",
              border: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
              borderRadius: 12, padding: "14px 16px",
              fontSize: 14, lineHeight: 1.7,
              color: dark ? "#d1cdc8" : "#1a1714",
              fontFamily: "'Lato', sans-serif",
              resize: "vertical", outline: "none",
            }}
          />
          <button
            onClick={saveBio}
            style={{
              marginTop: 12, padding: "10px 24px",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: "#fff", border: "none", borderRadius: 10,
              fontSize: 13, cursor: "pointer", fontFamily: "'Lato', sans-serif",
              opacity: bioStatus === "saving" ? 0.7 : 1,
            }}
          >
            {bioStatus === "saving" ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>

      {/* Conta */}
      <div>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: dark ? "#4b5563" : "#9ca3af", marginBottom: 12 }}>Conta</div>
        <div style={{ background: dark ? "rgba(255,255,255,0.02)" : "#fff", borderRadius: 16, border: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}`, overflow: "hidden" }}>
          <button onClick={logout} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12,
            padding: "18px 22px", background: "none", border: "none", cursor: "pointer",
            color: "#ef4444", fontSize: 14, textAlign: "left", fontFamily: "'Lato', sans-serif",
            transition: "background 0.2s",
          }}
            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(239,68,68,0.05)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "none"}
          >
            <Icon name="logout" size={16} />
            Sair da conta
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── NAV ITEMS ────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: "home", icon: "home", label: "Início" },
  { id: "diary", icon: "book", label: "Diário" },
  { id: "patterns", icon: "chart", label: "Padrões" },
  { id: "thoughts", icon: "network", label: "Linha" },
  { id: "feelings", icon: "cloud", label: "Sentimentos" },
  { id: "todos", icon: "check", label: "Intenções" },
  { id: "settings", icon: "settings", label: "Config." },
];

// ─── MAIN APP (com Firebase state management) ─────────────────────────────────
function AppInner() {
  const { user, logout } = useAuth();
  const [dark, setDark] = useState(false);
  const [page, setPage] = useState("home");
  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(true);

  const [aiPatterns, setAiPatterns] = useState(null);
  const [aiFeelings, setAiFeelings] = useState(null);
  const [aiNodes, setAiNodes] = useState(null);
  const [aiEdges, setAiEdges] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [userBio, setUserBio] = useState("");

  const toggle = () => setDark((p) => !p);

  // Carrega configurações salvas
  useEffect(() => {
    if (!user) return;
    FirebaseService.getSettings(user.uid).then((s) => {
      if (s?.darkMode !== undefined) setDark(s.darkMode);
    });
  }, [user]);

  // Carrega análise salva — só aplica se o usuário já tiver entradas
  // (será chamado depois que as entradas carregarem, via useEffect abaixo)
  const loadSavedAnalysis = useCallback(async (uid) => {
    const a = await FirebaseService.getAnalysis(uid);
    if (a) {
      if (a.patterns?.length) setAiPatterns(a.patterns);
      if (a.feelings?.length) setAiFeelings(a.feelings);
      if (a.nodes?.length) setAiNodes(a.nodes);
      if (a.edges?.length) setAiEdges(a.edges);
      if (a.summary) setAiSummary(a.summary);
    }
  }, []);

  // Subscription em tempo real das entradas do Firestore
  useEffect(() => {
    if (!user) return;
    setEntriesLoading(true);
    const unsub = FirebaseService.subscribeEntries(user.uid, (newEntries) => {
      setEntries(newEntries);
      setEntriesLoading(false);
    });
    return unsub;
  }, [user]);

  const runAnalysis = useCallback(async (entriesToAnalyze) => {
    if (!entriesToAnalyze?.length || analyzing) return;
    setAnalyzing(true);
    try {
      const result = await analyzeEntries(entriesToAnalyze);
      if (result) {
        if (result.patterns?.length) setAiPatterns(result.patterns);
        if (result.feelings?.length) setAiFeelings(result.feelings);
        if (result.nodes?.length) setAiNodes(result.nodes);
        if (result.edges?.length) setAiEdges(result.edges);
        if (result.summary) setAiSummary(result.summary);
        // Salva análise no Firebase
        if (user) {
          await FirebaseService.saveAnalysis(user.uid, result).catch(console.error);
        }
      }
    } catch (err) {
      console.error("Analysis error:", err);
    }
    setAnalyzing(false);
  }, [user]);

  // Carrega bio do usuário ao logar
  useEffect(() => {
    if (!user) return;
    FirebaseService.getBio(user.uid).then((bio) => setUserBio(bio || ""));
  }, [user]);

  // Quando entradas carregam: se houver entradas, carrega análise salva do Firebase.
  // Se não houver entradas, garante que as abas ficam limpas.
  useEffect(() => {
    if (entriesLoading || !user) return;
    if (entries.length > 0) {
      loadSavedAnalysis(user.uid);
    } else {
      setAiPatterns(null);
      setAiFeelings(null);
      setAiNodes(null);
      setAiEdges(null);
      setAiSummary(null);
    }
  }, [entriesLoading, user]);

  const bg = dark
    ? "linear-gradient(160deg, #080c14 0%, #0a0f1a 50%, #0c0d18 100%)"
    : "linear-gradient(160deg, #f7f5f2 0%, #faf9f7 50%, #f5f3f0 100%)";
  const sidebarBg = dark ? "#080c14" : "#f7f5f2";
  const borderColor = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";

  const renderPage = () => {
    switch (page) {
      case "home": return <HomePage dark={dark} setPage={setPage} />;
      case "diary": return <DiaryPage dark={dark} entries={entries} setEntries={setEntries} onAnalyze={runAnalysis} loading={entriesLoading} userBio={userBio} />;
      case "patterns": return <PatternsPage dark={dark} patterns={aiPatterns} analyzing={analyzing} onRefresh={() => runAnalysis(entries)} />;
      case "thoughts": return <ThoughtLinePage dark={dark} nodes={aiNodes} edges={aiEdges} analyzing={analyzing} />;
      case "feelings": return <FeelingsPage dark={dark} feelings={aiFeelings} analyzing={analyzing} summary={aiSummary} />;
      case "todos": return <TodoPage dark={dark} />;
      case "settings": return <SettingsPage dark={dark} toggleDark={toggle} userBio={userBio} setUserBio={setUserBio} />;
      default: return <HomePage dark={dark} setPage={setPage} />;
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: bg, display: "flex", transition: "background 0.4s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,300;0,400;1,300&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'Lato', sans-serif; }
        textarea, input { font-family: 'Lato', sans-serif; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px; }
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes pulse { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }
      `}</style>

      {/* Sidebar desktop */}
      <aside style={{
        width: 220, flexShrink: 0,
        background: sidebarBg,
        borderRight: `1px solid ${borderColor}`,
        display: "flex", flexDirection: "column",
        padding: "28px 0",
        position: "sticky", top: 0, height: "100vh",
        transition: "background 0.4s",
      }} className="sidebar-desktop">
        <div style={{ padding: "0 24px 32px" }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 14, color: dark ? "#818cf8" : "#7c3aed", fontStyle: "italic" }}>Diário do</div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 400, color: dark ? "#e8e4df" : "#1a1714", letterSpacing: "-0.01em" }}>Autoconhecimento</div>
          {analyzing && <div style={{ marginTop: 10 }}><AIBadge dark={dark} analyzing={true} /></div>}
          {user && (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, overflow: "hidden", flexShrink: 0 }}>
                {user.photoURL
                  ? <img src={user.photoURL} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                  : (user.displayName?.[0] || user.email?.[0] || "?").toUpperCase()
                }
              </div>
              <span style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user.displayName || user.email?.split("@")[0]}
              </span>
            </div>
          )}
        </div>

        <nav style={{ flex: 1, paddingBottom: 16 }}>
          {NAV_ITEMS.map((item) => {
            const active = page === item.id;
            return (
              <button key={item.id} onClick={() => setPage(item.id)} style={{
                display: "flex", alignItems: "center", gap: 12,
                width: "100%", padding: "11px 24px",
                background: active ? (dark ? "rgba(99,102,241,0.1)" : "rgba(99,102,241,0.08)") : "none",
                border: "none", cursor: "pointer", textAlign: "left",
                color: active ? (dark ? "#818cf8" : "#6366f1") : (dark ? "#6b7280" : "#9ca3af"),
                fontSize: 13, fontFamily: "'Lato', sans-serif",
                borderLeft: active ? `2px solid ${dark ? "#818cf8" : "#6366f1"}` : "2px solid transparent",
                transition: "all 0.15s",
              }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = dark ? "#d1cdc8" : "#3d3530"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = dark ? "#6b7280" : "#9ca3af"; }}
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div style={{ padding: "16px 24px", borderTop: `1px solid ${borderColor}`, display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", color: dark ? "#6b7280" : "#9ca3af", fontSize: 12, padding: 0, fontFamily: "'Lato', sans-serif" }}>
            <Icon name={dark ? "sun" : "moon"} size={14} />
            {dark ? "Modo claro" : "Modo escuro"}
          </button>
          <button onClick={logout} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 12, padding: 0, fontFamily: "'Lato', sans-serif", opacity: 0.7, transition: "opacity 0.2s" }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = "1"}
            onMouseLeave={(e) => e.currentTarget.style.opacity = "0.7"}
          >
            <Icon name="logout" size={14} />
            Sair da conta
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <div style={{ display: "none", position: "fixed", bottom: 0, left: 0, right: 0, background: dark ? "#080c14" : "#f7f5f2", borderTop: `1px solid ${borderColor}`, padding: "8px 0 max(8px, env(safe-area-inset-bottom))", zIndex: 100 }} className="mobile-nav">
        {NAV_ITEMS.map((item) => {
          const active = page === item.id;
          return (
            <button key={item.id} onClick={() => setPage(item.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: active ? (dark ? "#818cf8" : "#6366f1") : (dark ? "#4b5563" : "#c4b8ae"), padding: "6px 4px", transition: "color 0.15s" }}>
              <Icon name={item.icon} size={18} />
              <span style={{ fontSize: 9, letterSpacing: "0.04em" }}>{item.label}</span>
            </button>
          );
        })}
      </div>

      <main style={{ flex: 1, overflowY: "auto", paddingBottom: 80, minHeight: "100vh" }}>
        {renderPage()}
      </main>

      <style>{`
        @media (max-width: 700px) {
          .sidebar-desktop { display: none !important; }
          .mobile-nav { display: flex !important; }
        }
      `}</style>
    </div>
  );
}

// Loading screen while Firebase resolves auth
function LoadingScreen({ dark }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: dark ? "#080c14" : "#f7f5f2",
      display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20,
    }}>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 22, color: dark ? "#818cf8" : "#7c3aed", fontStyle: "italic" }}>
        Diário do Autoconhecimento
      </div>
      <Dots dark={dark || false} />
    </div>
  );
}

// ─── ROOT EXPORT ──────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function AuthGate() {
  const { user } = useAuth();

  // Still resolving — show loading
  if (user === undefined) return <LoadingScreen />;

  // Not logged in — show auth screen
  if (user === null) return <AuthPage dark={false} />;

  // Logged in — show main app
  return <AppInner />;
}

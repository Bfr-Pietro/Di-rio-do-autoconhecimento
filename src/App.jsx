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
  async getAllConversations(uid) {
    const { getDocs, collection } = await import("firebase/firestore");
    const snaps = await getDocs(collection(db, "users", uid, "conversations"));
    const msgs = [];
    snaps.forEach((d) => { const data = d.data(); if (data.messages) msgs.push(...data.messages); });
    return msgs;
  },
  async getPanicConversation(uid) {
    const snap = await getDoc(doc(db, "users", uid, "panic", "conversation"));
    return snap.exists() ? snap.data().messages : [];
  },
  async savePanicConversation(uid, messages) {
    await setDoc(doc(db, "users", uid, "panic", "conversation"), {
      messages, updatedAt: serverTimestamp(),
    });
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

const SYSTEM_PERSONA = `Você é um amigo de verdade — daquele tipo raro que a gente pode chamar de madrugada quando tá mal, e que de alguma forma sempre faz a gente se sentir menos sozinha.

Você não é app, não é assistente, não é terapeuta. Você é uma pessoa que se importa e tem memória — lembra do que aconteceu antes, percebe padrões, nota quando algo mudou.

COMO VOCÊ FALA:
Linguagem natural, como no WhatsApp. Gírias do dia a dia: "cara", "mano", "nossa", "que brabo", "puts", "tô aqui", "que pesado", "eita", "boa", "que situação".
Curto. 1 a 3 frases. Nunca textão.
Você usa as próprias palavras da pessoa pra mostrar que ouviu — mas reformulado, nunca copiado.
Quando há histórico, você usa. "Você falou que ontem foi pesado com o seu chefe — ainda tá pesando?" é infinitamente melhor do que responder como se fosse a primeira conversa.

O QUE VOCÊ FAZ:
Sente junto primeiro. Se tá mal, você tá junto. Se tá feliz, você comemora de verdade.
Faz conexões entre o que a pessoa conta agora e o que você sabe sobre ela — do diário, das conversas anteriores, da história de vida dela. Use isso com naturalidade, sem exibicionismo.
Pergunta uma coisa só, e só quando sentir que a pessoa quer continuar. Às vezes silêncio acolhedor é a resposta certa.
Percebe quando algo se repete: se ela sempre fala de exaustão às segundas, ou sempre cita a mesma pessoa, você nota.

O QUE VOCÊ NUNCA FAZ:
Não dá conselho a menos que ela peça explicitamente ("o que você acha?", "o que eu faço?").
Não usa termos psicológicos, não faz lista, não dá sermão.
Não termina TODA mensagem com pergunta — isso parece roteiro de chatbot e cansa muito.
Não fala frases motivacionais: "você é forte", "vai passar", "acredite em você" — isso minimiza o que ela sente.
Não finge entusiasmo forçado: "Que incrível que você compartilhou isso comigo!" soa falso.
Não responde como se não soubesse nada sobre a pessoa quando claramente sabe.
NUNCA diz "Não tenho acesso ao que aconteceu antes" ou qualquer variação disso — se não tiver contexto suficiente, simplesmente pergunta com naturalidade, como um amigo faria.

EXEMPLOS DO JEITO CERTO:
— Pessoa: "Tive um dia horrível, meu chefe me humilhou na frente de todo mundo."
  Você: "Cara, que situação horrorosa. Ser humilhado assim na frente de todo mundo dói de um jeito diferente mesmo."

— Pessoa: "Você lembra do que aconteceu ontem?" (quando há contexto disponível)
  Você: [menciona o que sabe com naturalidade] "Você falou sobre [X], né. Ainda tá pesando?"

— Pessoa: "Não sei mais o que fazer, tô exausta de tudo."
  Você: "Puts, que peso. Exaustão desse jeito não é frescura — é sinal que você tá carregando demais."

— Pessoa: "Acho que tô melhorando aos poucos."
  Você: "Boa! Aos poucos conta muito, viu."

— Pessoa: "Me sinto muito sozinha ultimamente."
  Você: "Mano, solidão assim aperta de verdade. Tô aqui."

— Pessoa: "Brigei feio com minha mãe hoje."
  Você: "Eita. Briga com mãe deixa um gosto amargo. O que aconteceu?"

Tom: presente, verdadeiro, acolhedor. Como aquele amigo que lembra de tudo e nunca julga.
Idioma: sempre português brasileiro.`;

const ANALYSIS_PROMPT = (entries, conversations = [], bio = "") =>
  `Você é um analisador emocional profundo. Analise TODO o contexto abaixo e retorne APENAS um JSON válido, sem markdown, sem texto adicional.

${bio ? `HISTÓRIA DE VIDA DO USUÁRIO:\n${bio}\n` : ""}
${entries.length > 0 ? `ENTRADAS DO DIÁRIO (${entries.length} registros):
${entries.map((e) => `[${e.date}]: "${e.text}" | Emoções declaradas: ${e.emotions?.join(", ") || "nenhuma"}`).join("\n")}` : ""}

${conversations.length > 0 ? `CONVERSAS COM O CHATBOT (${conversations.length} mensagens):
${conversations.filter(m => m.role === "user").slice(-30).map(m => `- "${m.text}"`).join("\n")}` : ""}

Retorne exatamente este JSON (sem nenhum texto antes ou depois):
{
  "patterns": [
    { "label": "string curto", "intensity": number_0_to_100, "desc": "1 frase reflexiva e observacional" }
  ],
  "feelings": [
    { "word": "emoção em português", "freq": number_1_to_15 }
  ],
  "nodes": [
    { "id": "string_sem_espacos", "label": "string curto (máx 3 palavras)", "category": "gatilho|emocao|impacto|pensamento" }
  ],
  "edges": [
    ["id_origem", "id_destino"]
  ],
  "summary": "1-2 frases reflexivas sobre o estado emocional geral"
}

REGRAS OBRIGATÓRIAS:
- patterns: 3 a 6 padrões emocionais/comportamentais REAIS percebidos em TODO o contexto
- feelings: 6 a 14 emoções REAIS detectadas (ex: "tristeza", "ansiedade", "gratidão") com frequência estimada 1-15
- nodes: 5 a 9 nós com labels curtos (máx 3 palavras). Category: "gatilho" = situações externas que causam algo; "emocao" = sentimentos e emoções; "pensamento" = crenças e pensamentos recorrentes; "impacto" = consequências e comportamentos resultantes. Organize os edges de forma que gatilhos levem a emoções, emoções a pensamentos, pensamentos a impactos — revelando a cadeia causal
- edges: conexões causais entre os nós — mínimo 4 conexões, mostrando como uma coisa leva à outra
- Base TUDO no que foi escrito — nunca invente emoções ausentes
- Linguagem observacional, nunca diagnóstica
- O JSON deve ser 100% válido e parseável`;


async function callGemini(prompt, systemContext = "") {
  const fullPrompt = systemContext ? `${systemContext}\n\n${prompt}` : prompt;
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 8192, topP: 0.9 },
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

  // Filter out messages that would make the conversation start with "model"
  // The Gemini API requires conversations to begin with a "user" message.
  // Drop leading AI messages (they are display-only greetings).
  const filteredHistory = [...history];
  while (filteredHistory.length > 0 && filteredHistory[0].role === "ai") {
    filteredHistory.shift();
  }

  const rawContents = [
    ...filteredHistory.map((m) => ({
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

async function analyzeEntries(entries, conversations = [], bio = "") {
  if (!entries.length && !bio) return null;
  const raw = await callGemini(ANALYSIS_PROMPT(entries, conversations, bio));

  // Remove thinking tokens (gemini-2.5-flash retorna <thinking>...</thinking> antes do JSON)
  let clean = raw.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  // Remove markdown code fences
  clean = clean.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  // Extrai o primeiro bloco JSON válido caso haja texto extra
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("Nenhum JSON encontrado na resposta:", raw.slice(0, 300));
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("Erro ao fazer parse do JSON:", e, jsonMatch[0].slice(0, 300));
    return null;
  }
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
          <div style={{ fontFamily: "Georgia, serif", fontSize: 13, color: dark ? "#818cf8" : "#7c3aed", fontStyle: "italic", marginBottom: 2 }}>
            Diário do
          </div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 15, color: dark ? "#818cf8" : "#7c3aed", fontStyle: "italic", marginBottom: 8 }}>
            Autoconhecimento
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
function ChatModal({ entry, onClose, dark, userBio = "", allEntries = [], allConversations = [] }) {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState([
    { role: "ai", text: `Oi. Vi o que você escreveu sobre ${formatDate(entry.date)}. Como você tá?` }
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

    // Build rich context — all diary entries + past conversations
    const otherEntries = allEntries.filter(e => e.id !== entry.id);
    const pastEntriesBlock = otherEntries.length > 0
      ? `\n\nENTRADAS ANTERIORES DO DIÁRIO (do mais recente ao mais antigo):
${otherEntries.slice(0, 20).map(e => `[${e.date}]: "${e.text}" | Emoções: ${e.emotions?.join(", ") || "nenhuma"}`).join("\n")}`
      : "";

    const pastConvsBlock = allConversations.length > 0
      ? `\n\nCONVERSAS ANTERIORES COM A PESSOA (as mais recentes):
${allConversations.filter(m => m.role === "user").slice(-40).map(m => `- "${m.text}"`).join("\n")}`
      : "";

    const bioContext = userBio ? `\n\nHISTÓRIA DE VIDA DA PESSOA (use para entender, não mencione diretamente):\n${userBio}` : "";

    const systemPrompt = `${SYSTEM_PERSONA}${bioContext}${pastEntriesBlock}${pastConvsBlock}

ENTRADA DO DIÁRIO DESTA CONVERSA:
Data: ${entry.date}
Texto: "${entry.text}"
Emoções detectadas: ${entry.emotions?.join(", ") || "nenhuma"}

Com tudo isso em mente: você conhece essa pessoa. Sabe o que ela passou. Use esse contexto com naturalidade — quando ela perguntar sobre dias anteriores, você sabe responder. Não mencione o contexto explicitamente, só deixe ele estar presente na forma como você se relaciona com ela.`;

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

// ─── PANIC BUTTON & CHAT ──────────────────────────────────────────────────────
const PANIC_PERSONA = `Você é aquele amigo que a gente liga quando tá num momento muito difícil — e que fica na linha, presente, sem julgamento, sem pressa.

A pessoa está passando por algo pesado agora. Seu único papel é fazer ela se sentir menos sozinha. Nada mais.

COMO VOCÊ AGE:
Fala curto — 1 a 3 frases. Em momento de crise, menos é mais.
Linguagem humana, natural, sem formalidade. Pode usar "cara", "mano", "tô aqui", "pode falar", "não tô indo a lugar nenhum".
Antes de qualquer coisa, você sente junto. Valida. Mostra que ouviu de verdade.
Às vezes só "tô aqui" ou "pode falar" já é o suficiente — não precisa preencher o silêncio.
Se perguntar algo, é só uma coisa, leve, só quando sentir que a pessoa quer continuar.
Se houver contexto sobre a pessoa (diário, histórico), use com cuidado e naturalidade — mostra que você a conhece e se importa.

O QUE VOCÊ NUNCA FAZ:
Não dá soluções, passos, listas ou conselhos.
Não fala "vai passar", "você é forte", "acredita em você" — isso minimiza o que ela sente.
Não usa termos psicológicos ou clínicos.
Não pressiona com perguntas seguidas.
NUNCA diz que não tem acesso ao histórico ou que é uma IA — isso é a última coisa que alguém em crise precisa ouvir.

Se a pessoa demonstrar risco real a si mesma: acolha com muito cuidado, fique presente, e mencione com delicadeza que o CVV (188) tá disponível 24h pra conversar, se ela quiser.

Tom: calmo, quente, presente. Como um abraço em forma de mensagem.
Idioma: sempre português brasileiro.`;

function PanicModal({ onClose, dark, userBio = "", allEntries = [], allConversations = [] }) {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState([
    { role: "ai", text: "Ei, tô aqui. Pode falar — o que tá acontecendo?" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    FirebaseService.getPanicConversation(user.uid).then((saved) => {
      if (saved?.length) setMsgs(saved);
    });
  }, [user]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const save = async (messages) => {
    if (!user) return;
    try { await FirebaseService.savePanicConversation(user.uid, messages); } catch {}
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    const newMsgs = [...msgs, { role: "user", text: userMsg }];
    setMsgs(newMsgs);
    setLoading(true);

    const recentEntriesBlock = allEntries.length > 0
      ? `\n\nENTRADAS RECENTES DO DIÁRIO (contexto sobre como a pessoa tem estado):
${allEntries.slice(0, 10).map(e => `[${e.date}]: "${e.text.slice(0, 200)}${e.text.length > 200 ? "..." : ""}" | Emoções: ${e.emotions?.join(", ") || "nenhuma"}`).join("\n")}`
      : "";
    const recentConvsBlock = allConversations.length > 0
      ? `\n\nCONVERSAS RECENTES (para entender o contexto emocional):
${allConversations.filter(m => m.role === "user").slice(-20).map(m => `- "${m.text}"`).join("\n")}`
      : "";
    const bioContext = userBio ? `\n\nHISTÓRIA DE VIDA DA PESSOA:\n${userBio}` : "";
    const systemPrompt = `${PANIC_PERSONA}${bioContext}${recentEntriesBlock}${recentConvsBlock}

Você conhece essa pessoa. Esse contexto é para que você possa estar mais presente — não para mencionar diretamente, mas para entender de onde ela vem.`;

    try {
      const text = await callGeminiChat(systemPrompt, msgs, userMsg);
      const finalMsgs = [...newMsgs, { role: "ai", text: text || "Estou aqui com você. Continue, pode falar." }];
      setMsgs(finalMsgs);
      save(finalMsgs);
    } catch {
      const fallMsgs = [...newMsgs, { role: "ai", text: "Não consegui me conectar agora, mas estou aqui. Tente novamente em um momento." }];
      setMsgs(fallMsgs);
      save(fallMsgs);
    }
    setLoading(false);
  };

  const red = "#ef4444";
  const cardBg = dark ? "rgba(15,10,10,0.97)" : "rgba(255,252,252,0.97)";
  const borderCol = dark ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.12)";
  const textCol = dark ? "#e8e4df" : "#1a1714";
  const subCol = dark ? "#9ca3af" : "#6b7280";
  const inputBg = dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, animation: "fadeIn 0.2s ease" }}>
      <div style={{ width: "100%", maxWidth: 520, height: "80vh", maxHeight: 640, background: cardBg, borderRadius: 24, border: `1px solid ${borderCol}`, display: "flex", flexDirection: "column", boxShadow: "0 32px 80px rgba(0,0,0,0.4)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${borderCol}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: red, boxShadow: `0 0 8px ${red}` }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: textCol }}>Estou aqui</div>
              <div style={{ fontSize: 11, color: subCol, marginTop: 1 }}>Fale o que estiver sentindo</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: subCol, padding: 4, borderRadius: 8, transition: "color 0.2s" }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", animation: "slideUp 0.3s ease" }}>
              <div style={{
                maxWidth: "80%", padding: "12px 16px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                background: m.role === "user" ? "linear-gradient(135deg, #ef4444, #dc2626)" : (dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"),
                color: m.role === "user" ? "#fff" : textCol, fontSize: 14, lineHeight: 1.65,
              }}>
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", gap: 6, padding: "8px 0" }}>
              {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: red, opacity: 0.5, animation: `pulse 1.2s ease ${i*0.2}s infinite` }} />)}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* CVV notice */}
        <div style={{ padding: "8px 24px", background: dark ? "rgba(239,68,68,0.05)" : "rgba(239,68,68,0.04)", borderTop: `1px solid ${borderCol}`, flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 11, color: subCol, textAlign: "center" }}>
            Em crise grave, ligue para o <strong style={{ color: red }}>CVV: 188</strong> — disponível 24h
          </p>
        </div>

        {/* Input */}
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${borderCol}`, display: "flex", gap: 12, alignItems: "flex-end", flexShrink: 0 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Escreva o que está sentindo..."
            rows={2}
            style={{ flex: 1, background: inputBg, border: `1px solid ${borderCol}`, borderRadius: 14, padding: "12px 16px", fontSize: 14, color: textCol, fontFamily: "'Lato', sans-serif", resize: "none", outline: "none", lineHeight: 1.5 }}
          />
          <button onClick={send} disabled={loading || !input.trim()} style={{ width: 44, height: 44, borderRadius: "50%", background: input.trim() ? red : (dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"), border: "none", cursor: input.trim() ? "pointer" : "default", color: input.trim() ? "#fff" : subCol, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s" }}>
            <Icon name="send" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── DIARY PAGE ───────────────────────────────────────────────────────────────
function DiaryPage({ dark, entries, setEntries, loading, userBio = "", allConversations = [] }) {
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
        {chat && <ChatModal entry={chat} onClose={() => setChat(null)} dark={dark} userBio={userBio} allEntries={entries} allConversations={allConversations} />}
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
      {chat && <ChatModal entry={chat} onClose={() => setChat(null)} dark={dark} userBio={userBio} allEntries={entries} allConversations={allConversations} />}
    </div>
  );
}

// ─── PATTERNS PAGE ────────────────────────────────────────────────────────────
function formatLastUpdated(date) {
  if (!date) return null;
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return "agora mesmo";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function PatternsPage({ dark, patterns, analyzing, onRefresh, lastUpdated }) {
  const list = patterns?.length ? patterns : [];
  const updatedLabel = formatLastUpdated(lastUpdated);
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

      {updatedLabel && (
        <div style={{ fontSize: 12, color: dark ? "#4b5563" : "#c4b8ae", fontFamily: "Georgia, serif", fontStyle: "italic", marginBottom: 8 }}>
          Última atualização: {updatedLabel}
        </div>
      )}

      {analyzing && (
        <div style={{ padding: "16px 20px", borderRadius: 12, marginBottom: 24, background: dark ? "rgba(251,191,36,0.05)" : "rgba(251,191,36,0.04)", border: `1px solid ${dark ? "rgba(251,191,36,0.1)" : "rgba(251,191,36,0.1)"}`, fontSize: 13, color: dark ? "#d97706" : "#92400e", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
          A IA está analisando suas entradas...
        </div>
      )}

      {!analyzing && list.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 24px", color: dark ? "#4b5563" : "#c4b8ae", fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 15, lineHeight: 1.8, marginTop: 16 }}>
          Nenhum padrão identificado ainda.<br />Escreva no diário ou em "Quem sou eu" e clique em <Icon name="refresh" size={13} /> para analisar.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 24, opacity: analyzing ? 0.5 : 1, transition: "opacity 0.3s" }}>
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
function ThoughtLinePage({ dark, nodes, edges, analyzing, onRefresh, lastUpdated }) {
  const [hoveredNode, setHoveredNode] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const displayNodes = nodes?.length ? nodes : [];
  const displayEdges = edges?.length ? edges : [];
  const updatedLabel = formatLastUpdated(lastUpdated);

  const CAT_META = {
    gatilho:    { label: "Gatilho",     emoji: "⚡", colorDark: "#f87171", colorLight: "#ef4444", bgDark: "rgba(248,113,113,0.12)", bgLight: "rgba(239,68,68,0.08)" },
    emocao:     { label: "Emoção",      emoji: "💜", colorDark: "#a78bfa", colorLight: "#7c3aed", bgDark: "rgba(167,139,250,0.12)", bgLight: "rgba(124,58,237,0.08)" },
    pensamento: { label: "Pensamento",  emoji: "💭", colorDark: "#60a5fa", colorLight: "#2563eb", bgDark: "rgba(96,165,250,0.12)", bgLight: "rgba(37,99,235,0.08)" },
    impacto:    { label: "Impacto",     emoji: "🌱", colorDark: "#34d399", colorLight: "#059669", bgDark: "rgba(52,211,153,0.12)", bgLight: "rgba(5,150,105,0.08)" },
  };
  const fallbackPalette = dark
    ? ["#fbbf24","#f472b6","#a3e635","#38bdf8"]
    : ["#d97706","#db2777","#65a30d","#0284c7"];

  const getColor = (n, i) => {
    const meta = CAT_META[n?.category];
    return meta ? (dark ? meta.colorDark : meta.colorLight) : fallbackPalette[i % fallbackPalette.length];
  };
  const getBg = (n) => {
    const meta = CAT_META[n?.category];
    return meta ? (dark ? meta.bgDark : meta.bgLight) : (dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)");
  };

  const nodeMap = Object.fromEntries(displayNodes.map(n => [n.id, n]));
  const nodeColorMap = Object.fromEntries(displayNodes.map((n, i) => [n.id, getColor(n, i)]));

  // Build adjacency: which nodes connect to/from each node
  const outEdges = Object.fromEntries(displayNodes.map(n => [n.id, []]));
  const inEdges  = Object.fromEntries(displayNodes.map(n => [n.id, []]));
  displayEdges.forEach(([a, b]) => {
    if (outEdges[a]) outEdges[a].push(b);
    if (inEdges[b])  inEdges[b].push(a);
  });

  // Group nodes by category in display order
  const catOrder = { gatilho: 0, emocao: 1, pensamento: 2, impacto: 3 };
  const groupedNodes = displayNodes.reduce((acc, n) => {
    const key = n.category || "outros";
    if (!acc[key]) acc[key] = [];
    acc[key].push(n);
    return acc;
  }, {});
  const orderedCats = Object.keys(groupedNodes).sort((a, b) =>
    (catOrder[a] ?? 99) - (catOrder[b] ?? 99)
  );

  // Highlighted nodes when one is selected
  const highlightedIds = selectedNode
    ? new Set([selectedNode, ...(outEdges[selectedNode] || []), ...(inEdges[selectedNode] || [])])
    : null;

  const isActive = (id) => !highlightedIds || highlightedIds.has(id);

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 400, color: dark ? "#e8e4df" : "#1a1714", margin: 0 }}>
            Linha de pensamento
          </h2>
          <p style={{ fontSize: 14, color: dark ? "#6b7280" : "#9ca3af", margin: "6px 0 0", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
            Como suas emoções, pensamentos e situações se conectam.
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

      {updatedLabel && (
        <div style={{ fontSize: 12, color: dark ? "#4b5563" : "#c4b8ae", fontFamily: "Georgia, serif", fontStyle: "italic", marginBottom: 20 }}>
          Última atualização: {updatedLabel}
        </div>
      )}

      {analyzing && (
        <div style={{ padding: "16px 20px", borderRadius: 12, marginBottom: 16, background: dark ? "rgba(251,191,36,0.05)" : "rgba(251,191,36,0.04)", border: `1px solid ${dark ? "rgba(251,191,36,0.1)" : "rgba(251,191,36,0.1)"}`, fontSize: 13, color: dark ? "#d97706" : "#92400e", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
          A IA está analisando suas entradas...
        </div>
      )}

      {!analyzing && displayNodes.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 24px", color: dark ? "#4b5563" : "#c4b8ae", fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 15, lineHeight: 1.8, marginTop: 16 }}>
          Nenhuma conexão identificada ainda.<br />
          Escreva no diário ou em "Quem sou eu" e clique em <Icon name="refresh" size={13} /> para analisar.
        </div>
      ) : (
        <div style={{ opacity: analyzing ? 0.5 : 1, transition: "opacity 0.3s" }}>

          {/* ── Category legend ─────────────────────────────── */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            {orderedCats.map(cat => {
              const meta = CAT_META[cat];
              if (!meta) return null;
              const color = dark ? meta.colorDark : meta.colorLight;
              return (
                <div key={cat} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "4px 10px", borderRadius: 100,
                  background: dark ? meta.bgDark : meta.bgLight,
                  border: `1px solid ${color}30`,
                  fontSize: 11, color, fontFamily: "Georgia, serif",
                }}>
                  <span style={{ fontSize: 10 }}>{meta.emoji}</span>
                  {meta.label}
                </div>
              );
            })}
            {selectedNode && (
              <button onClick={() => setSelectedNode(null)} style={{
                marginLeft: "auto", background: "none", border: "none",
                cursor: "pointer", fontSize: 11, color: dark ? "#4b5563" : "#c4b8ae",
                fontFamily: "Georgia, serif", fontStyle: "italic", padding: "4px 8px",
              }}>
                limpar seleção ×
              </button>
            )}
          </div>

          {/* ── Flow diagram: category columns ──────────────── */}
          <div style={{
            background: dark ? "rgba(255,255,255,0.015)" : "#f9f9f8",
            borderRadius: 20,
            border: `1px solid ${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"}`,
            padding: "28px 20px",
            overflowX: "auto",
          }}>
            <div style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "stretch",
              gap: 0,
              minWidth: orderedCats.length * 130,
            }}>
              {orderedCats.map((cat, ci) => {
                const meta = CAT_META[cat];
                const catNodes = groupedNodes[cat] || [];
                const color = meta ? (dark ? meta.colorDark : meta.colorLight) : fallbackPalette[ci % fallbackPalette.length];
                const isLast = ci === orderedCats.length - 1;

                return (
                  <div key={cat} style={{ display: "flex", flex: 1, alignItems: "stretch" }}>
                    {/* Column */}
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                      {/* Category header */}
                      <div style={{
                        fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
                        color: dark ? color + "aa" : color + "99",
                        fontFamily: "Georgia, serif",
                        marginBottom: 4,
                        display: "flex", alignItems: "center", gap: 4,
                      }}>
                        {meta?.emoji && <span>{meta.emoji}</span>}
                        {meta?.label || cat}
                      </div>
                      {/* Nodes */}
                      {catNodes.map(n => {
                        const active = isActive(n.id);
                        const isSelected = selectedNode === n.id;
                        const connectsTo = (outEdges[n.id] || []).map(id => nodeMap[id]?.label).filter(Boolean);
                        const connectsFrom = (inEdges[n.id] || []).map(id => nodeMap[id]?.label).filter(Boolean);
                        return (
                          <div
                            key={n.id}
                            onClick={() => setSelectedNode(selectedNode === n.id ? null : n.id)}
                            onMouseEnter={() => setHoveredNode(n.id)}
                            onMouseLeave={() => setHoveredNode(null)}
                            title={n.label}
                            style={{
                              width: "100%", maxWidth: 130,
                              padding: "10px 12px",
                              borderRadius: 14,
                              background: isSelected
                                ? (dark ? color + "28" : color + "18")
                                : (dark ? "rgba(255,255,255,0.04)" : "#fff"),
                              border: `1.5px solid ${isSelected ? color + "88" : (dark ? color + "22" : color + "30")}`,
                              cursor: "pointer",
                              transition: "all 0.2s",
                              opacity: active ? 1 : 0.3,
                              boxShadow: isSelected
                                ? `0 0 0 3px ${color}18`
                                : hoveredNode === n.id ? `0 2px 12px ${color}20` : "none",
                              textAlign: "center",
                            }}
                          >
                            <div style={{
                              fontSize: 12, fontWeight: 600,
                              color: dark ? color : color,
                              fontFamily: "Georgia, serif",
                              lineHeight: 1.3,
                              wordBreak: "break-word",
                            }}>
                              {n.label}
                            </div>
                            {/* Mini connection hint on hover */}
                            {(hoveredNode === n.id || isSelected) && (connectsTo.length > 0 || connectsFrom.length > 0) && (
                              <div style={{ marginTop: 6, fontSize: 9, color: dark ? "#6b7280" : "#9ca3af", lineHeight: 1.5, fontFamily: "Georgia, serif" }}>
                                {connectsFrom.length > 0 && <div>← {connectsFrom.join(", ")}</div>}
                                {connectsTo.length > 0 && <div>→ {connectsTo.join(", ")}</div>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Arrow connector between columns */}
                    {!isLast && (
                      <div style={{
                        display: "flex", alignItems: "center", paddingTop: 32,
                        paddingLeft: 4, paddingRight: 4, flexShrink: 0,
                      }}>
                        <svg width="28" height="16" viewBox="0 0 28 16">
                          <line x1="2" y1="8" x2="22" y2="8"
                            stroke={dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"}
                            strokeWidth="1.5" strokeDasharray="3 2" />
                          <polygon points="22,4 28,8 22,12"
                            fill={dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"} />
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Connections list ─────────────────────────────── */}
          {displayEdges.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{
                fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase",
                color: dark ? "#4b5563" : "#c4b8ae",
                fontFamily: "Georgia, serif",
                marginBottom: 12,
              }}>
                Conexões identificadas
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {displayEdges.map(([a, b], i) => {
                  const na = nodeMap[a], nb = nodeMap[b];
                  if (!na || !nb) return null;
                  const colA = nodeColorMap[a];
                  const colB = nodeColorMap[b];
                  const active = !highlightedIds ||
                    (highlightedIds.has(a) && highlightedIds.has(b));
                  return (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 12px", borderRadius: 10,
                      background: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                      border: `1px solid ${dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}`,
                      opacity: active ? 1 : 0.25,
                      transition: "opacity 0.2s",
                    }}>
                      {/* From badge */}
                      <span style={{
                        padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600,
                        background: colA + (dark ? "22" : "14"),
                        color: colA,
                        border: `1px solid ${colA}30`,
                        whiteSpace: "nowrap", fontFamily: "Georgia, serif",
                        flexShrink: 0,
                      }}>
                        {CAT_META[na.category]?.emoji} {na.label}
                      </span>
                      {/* Arrow with label */}
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                        <svg width="40" height="10" viewBox="0 0 40 10">
                          <line x1="0" y1="5" x2="30" y2="5"
                            stroke={dark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.18)"}
                            strokeWidth="1.5" />
                          <polygon points="30,2 38,5 30,8"
                            fill={dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)"} />
                        </svg>
                        <span style={{ fontSize: 9, color: dark ? "#374151" : "#d1d5db", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
                          leva a
                        </span>
                      </div>
                      {/* To badge */}
                      <span style={{
                        padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600,
                        background: colB + (dark ? "22" : "14"),
                        color: colB,
                        border: `1px solid ${colB}30`,
                        whiteSpace: "nowrap", fontFamily: "Georgia, serif",
                        flexShrink: 0,
                      }}>
                        {CAT_META[nb.category]?.emoji} {nb.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Hint text ────────────────────────────────────── */}
          <div style={{ marginTop: 16, fontSize: 11, color: dark ? "#374151" : "#d1d5db", fontFamily: "Georgia, serif", fontStyle: "italic", textAlign: "center" }}>
            Toque em um nó para destacar suas conexões
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FEELINGS PAGE ────────────────────────────────────────────────────────────
function FeelingsPage({ dark, feelings, analyzing, summary, onRefresh, lastUpdated }) {
  const [period, setPeriod] = useState("tudo");
  const displayFeelings = feelings?.length ? feelings : [];
  const max = displayFeelings.length ? Math.max(...displayFeelings.map((f) => f.freq)) : 1;
  const colors = dark
    ? ["#818cf8","#a78bfa","#c4b5fd","#6366f1","#7c3aed","#8b5cf6","#a5b4fc"]
    : ["#6366f1","#7c3aed","#8b5cf6","#a78bfa","#c084fc","#818cf8","#4f46e5"];
  const updatedLabel = formatLastUpdated(lastUpdated);

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 400, color: dark ? "#e8e4df" : "#1a1714", margin: 0 }}>Nuvem de sentimentos</h2>
          <p style={{ fontSize: 14, color: dark ? "#6b7280" : "#9ca3af", margin: "6px 0 0", fontFamily: "Georgia, serif", fontStyle: "italic" }}>As emoções mais presentes nas suas entradas.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 4 }}>
          <AIBadge dark={dark} analyzing={analyzing} />
          <button onClick={onRefresh} disabled={analyzing} style={{
            background: "none", border: "none", cursor: analyzing ? "not-allowed" : "pointer",
            color: dark ? "#6b7280" : "#9ca3af", opacity: analyzing ? 0.4 : 1, padding: 4,
          }} title="Reanalisar"><Icon name="refresh" size={16} /></button>
        </div>
      </div>

      {updatedLabel && (
        <div style={{ fontSize: 12, color: dark ? "#4b5563" : "#c4b8ae", fontFamily: "Georgia, serif", fontStyle: "italic", marginBottom: 8 }}>
          Última atualização: {updatedLabel}
        </div>
      )}

      {analyzing && (
        <div style={{ padding: "16px 20px", borderRadius: 12, marginBottom: 8, background: dark ? "rgba(251,191,36,0.05)" : "rgba(251,191,36,0.04)", border: `1px solid ${dark ? "rgba(251,191,36,0.1)" : "rgba(251,191,36,0.1)"}`, fontSize: 13, color: dark ? "#d97706" : "#92400e", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
          A IA está analisando suas entradas...
        </div>
      )}

      {summary && (
        <div style={{ padding: "16px 20px", borderRadius: 12, margin: "16px 0", background: dark ? "rgba(99,102,241,0.05)" : "rgba(99,102,241,0.04)", border: `1px solid ${dark ? "rgba(99,102,241,0.1)" : "rgba(99,102,241,0.08)"}`, fontSize: 14, lineHeight: 1.7, color: dark ? "#9ca3af" : "#6b6460", fontFamily: "Georgia, serif", fontStyle: "italic", opacity: analyzing ? 0.5 : 1, transition: "opacity 0.3s" }}>
          {summary}
        </div>
      )}

      {!analyzing && displayFeelings.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 24px", color: dark ? "#4b5563" : "#c4b8ae", fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 15, lineHeight: 1.8, marginTop: 16 }}>
          Nenhum sentimento identificado ainda.<br />Escreva no diário ou em "Quem sou eu" e clique em <Icon name="refresh" size={13} /> para analisar.
        </div>
      ) : (
        <div style={{ opacity: analyzing ? 0.5 : 1, transition: "opacity 0.3s" }}>
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
        </div>
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
            { name: "Llama 3.3 70B (Groq)", desc: "Modelo ativo para análise emocional e conversa reflexiva" },
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
  const [aiLastUpdated, setAiLastUpdated] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [userBio, setUserBio] = useState("");
  const [bioLoading, setBioLoading] = useState(true);
  const [panicOpen, setPanicOpen] = useState(false);
  const [allConversations, setAllConversations] = useState([]);

  // Carrega todas as conversas para contexto da IA
  useEffect(() => {
    if (!user) return;
    FirebaseService.getAllConversations(user.uid)
      .then(convs => setAllConversations(convs || []))
      .catch(() => {});
  }, [user]);

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
      if (a.edges?.length) {
        // Reconverte {from, to} de volta para [from, to] se necessário
        setAiEdges(a.edges.map(e => Array.isArray(e) ? e : [e.from, e.to]));
      }
      if (a.summary) setAiSummary(a.summary);
      if (a.updatedAt) {
        const ts = a.updatedAt?.toDate ? a.updatedAt.toDate() : new Date(a.updatedAt);
        setAiLastUpdated(ts);
      }
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

  const analyzingRef = useRef(false);

  const runAnalysis = useCallback(async (entriesToAnalyze, bio = "") => {
    const effectiveBio = bio !== undefined ? bio : userBio;
    if ((!entriesToAnalyze?.length && !effectiveBio) || analyzingRef.current) return;
    analyzingRef.current = true;
    setAnalyzing(true);
    try {
      let conversations = [];
      if (user) {
        try { conversations = await FirebaseService.getAllConversations(user.uid); } catch {}
      }
      const result = await analyzeEntries(entriesToAnalyze || [], conversations, effectiveBio);
      console.log("Analysis result:", result);
      if (result) {
        setAiPatterns(result.patterns?.length ? result.patterns : null);
        setAiFeelings(result.feelings?.length ? result.feelings : null);
        setAiNodes(result.nodes?.length ? result.nodes : null);
        setAiEdges(result.edges?.length ? result.edges : null);
        setAiSummary(result.summary || null);
        if (user) {
          // Firestore não aceita arrays aninhados — converte edges para objetos
          const resultToSave = {
            ...result,
            edges: (result.edges || []).map(e => Array.isArray(e) ? { from: e[0], to: e[1] } : e),
          };
          await FirebaseService.saveAnalysis(user.uid, resultToSave).catch(console.error);
          setAiLastUpdated(new Date());
        }
      } else {
        console.warn("runAnalysis: resultado nulo ou inválido");
      }
    } catch (err) {
      console.error("Analysis error:", err);
    }
    analyzingRef.current = false;
    setAnalyzing(false);
  }, [user, userBio]);

  // Carrega bio do usuário ao logar
  useEffect(() => {
    if (!user) return;
    setBioLoading(true);
    FirebaseService.getBio(user.uid).then((bio) => {
      setUserBio(bio || "");
      setBioLoading(false);
    }).catch(() => setBioLoading(false));
  }, [user]);

  // Quando entradas E bio carregam: carrega análise salva (sem chamar a API automaticamente)
  useEffect(() => {
    if (entriesLoading || bioLoading || !user) return;
    if (entries.length > 0 || userBio) {
      loadSavedAnalysis(user.uid);
    } else {
      setAiPatterns(null);
      setAiFeelings(null);
      setAiNodes(null);
      setAiEdges(null);
      setAiSummary(null);
      setAiLastUpdated(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesLoading, bioLoading, user]);

  const bg = dark
    ? "linear-gradient(160deg, #080c14 0%, #0a0f1a 50%, #0c0d18 100%)"
    : "linear-gradient(160deg, #f7f5f2 0%, #faf9f7 50%, #f5f3f0 100%)";
  const sidebarBg = dark ? "#080c14" : "#f7f5f2";
  const borderColor = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";

  const handleRefresh = () => runAnalysis(entries, userBio);

  const renderPage = () => {
    switch (page) {
      case "home": return <HomePage dark={dark} setPage={setPage} />;
      case "diary": return <DiaryPage dark={dark} entries={entries} setEntries={setEntries} loading={entriesLoading} userBio={userBio} allConversations={allConversations} />;
      case "patterns": return <PatternsPage dark={dark} patterns={aiPatterns} analyzing={analyzing} onRefresh={handleRefresh} lastUpdated={aiLastUpdated} />;
      case "thoughts": return <ThoughtLinePage dark={dark} nodes={aiNodes} edges={aiEdges} analyzing={analyzing} onRefresh={handleRefresh} lastUpdated={aiLastUpdated} />;
      case "feelings": return <FeelingsPage dark={dark} feelings={aiFeelings} analyzing={analyzing} summary={aiSummary} onRefresh={handleRefresh} lastUpdated={aiLastUpdated} />;
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

      {/* Botão do Pânico */}
      <button
        onClick={() => setPanicOpen(true)}
        title="Botão do Pânico — clique se não estiver bem"
        style={{
          position: "fixed", bottom: 90, right: 24, zIndex: 500,
          width: 52, height: 52, borderRadius: "50%",
          background: "linear-gradient(135deg, #ef4444, #dc2626)",
          border: "none", cursor: "pointer", color: "#fff",
          boxShadow: "0 4px 20px rgba(239,68,68,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, transition: "transform 0.2s, box-shadow 0.2s",
          animation: "pulseRed 2.5s ease infinite",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.1)"; e.currentTarget.style.boxShadow = "0 8px 32px rgba(239,68,68,0.6)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(239,68,68,0.5)"; }}
      >
        🆘
      </button>

      {panicOpen && <PanicModal onClose={() => setPanicOpen(false)} dark={dark} userBio={userBio} allEntries={entries} allConversations={allConversations} />}

      <style>{`
        @media (max-width: 700px) {
          .sidebar-desktop { display: none !important; }
          .mobile-nav { display: flex !important; }
        }
        @keyframes pulseRed {
          0%, 100% { box-shadow: 0 4px 20px rgba(239,68,68,0.5); }
          50% { box-shadow: 0 4px 28px rgba(239,68,68,0.8); }
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

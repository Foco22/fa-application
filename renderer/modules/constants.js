export const CATEGORIES = [
  { group: 'Computación / IA', items: ['cs.AI','cs.LG','cs.CL','cs.CV','cs.RO','cs.NE','stat.ML'] },
  { group: 'Economía',         items: ['econ.GN','econ.EM','econ.TH'] },
  { group: 'Finanzas cuant.',  items: ['q-fin.PM','q-fin.TR','q-fin.MF','q-fin.ST'] },
  { group: 'Biología cuantit.',items: ['q-bio.NC','q-bio.PE','q-bio.QM','q-bio.BM'] },
  { group: 'Física',           items: ['physics.data-an','cond-mat.stat-mech','quant-ph'] },
  { group: 'Estadística',      items: ['stat.TH','stat.AP','stat.ME'] },
  { group: 'Matemáticas',      items: ['math.ST','math.OC','math.PR'] },
]

export const CATEGORY_LABELS = {
  'cs.AI':              'Artificial Intelligence',
  'cs.LG':              'Machine Learning',
  'cs.CL':              'Computation and Language (NLP)',
  'cs.CV':              'Computer Vision and Pattern Recognition',
  'cs.RO':              'Robotics',
  'cs.NE':              'Neural and Evolutionary Computing',
  'stat.ML':            'Machine Learning (Statistics)',
  'econ.GN':            'General Economics',
  'econ.EM':            'Econometrics',
  'econ.TH':            'Theoretical Economics',
  'q-fin.PM':           'Portfolio Management',
  'q-fin.TR':           'Trading and Market Microstructure',
  'q-fin.MF':           'Mathematical Finance',
  'q-fin.ST':           'Statistical Finance',
  'q-bio.NC':           'Neurons and Cognition',
  'q-bio.PE':           'Populations and Evolution',
  'q-bio.QM':           'Quantitative Methods (Biology)',
  'q-bio.BM':           'Biomolecules',
  'physics.data-an':    'Data Analysis, Statistics and Probability',
  'cond-mat.stat-mech': 'Statistical Mechanics',
  'quant-ph':           'Quantum Physics',
  'stat.TH':            'Statistics Theory',
  'stat.AP':            'Applications (Statistics)',
  'stat.ME':            'Methodology (Statistics)',
  'math.ST':            'Statistics Theory (Mathematics)',
  'math.OC':            'Optimization and Control',
  'math.PR':            'Probability',
}

export const DEFAULT_UNIVERSITIES = [
  'MIT','Stanford','Oxford','Cambridge','ETH Zurich',
  'UC Berkeley','Harvard','Princeton','Caltech','Columbia','Yale',
  'University of Toronto','Université de Montréal','NYU','EPFL',
  'University of Washington','Georgia Tech','University of Michigan',
  'Imperial College London',
]

export const DEFAULT_RESEARCH_CENTERS = [
  'Anthropic',
  'OpenAI',
  'Google DeepMind',
  'Google Brain',
  'Google Research',
  'Meta AI',
  'Meta FAIR',
  'Microsoft Research',
  'Apple',
  'Mistral AI',
  'Cohere',
  'Allen Institute for AI',
  'EleutherAI',
  'Hugging Face',
  'NVIDIA Research',
  'IBM Research',
  'Amazon',
  'DeepSeek',
  'xAI',
]

// Claves del diccionario, no texto: el badge de estado del paper se traduce
// como el resto de la UI (ver renderer/i18n.js).
export const STATUS_KEYS = {
  new:         'estado-nuevo',
  downloading: 'estado-descargando',
  ready:       'estado-listo',
  pdf_error:   'estado-archivo-error',
  error:       'estado-error',
}

export const TABS = ['pdf', 'abstract', 'resumen', 'notas', 'quiz', 'ocr']

export const LLM_PROVIDERS = {
  openai:    { label: 'OpenAI API Key',    placeholder: 'sk-...',   models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'] },
  anthropic: { label: 'Anthropic API Key', placeholder: 'sk-ant-...', models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
  deepseek:  { label: 'DeepSeek API Key',  placeholder: 'sk-...',   models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'] },
}

// `local` corre con Transformers.js dentro de la app: descarga el modelo la
// primera vez y después no necesita internet ni API key. Cambiar de proveedor
// invalida el índice de referencia (los vectores no son comparables entre
// modelos) — hay que reindexar.
// `suggestedThreshold`: cada modelo tiene su propia escala de similitud coseno.
// MiniLM da ~0.40 entre dos abstracts claramente relacionados, donde OpenAI da
// ~0.6–0.7 — con el umbral de OpenAI el motor local rechazaría todo.
export const EMBEDDING_PROVIDERS = {
  openai: { name: 'OpenAI (API)', label: 'OpenAI API Key', placeholder: 'sk-...', models: ['text-embedding-3-small', 'text-embedding-3-large'], needsKey: true, suggestedThreshold: '0.6' },
  local:  { name: 'Local (gratis, sin internet)', label: null, placeholder: null, models: ['Xenova/all-MiniLM-L6-v2', 'Xenova/bge-small-en-v1.5'], needsKey: false, suggestedThreshold: '0.4' },
}

// Web Speech API se eliminó de las opciones: es transcripción nativa del navegador,
// sin llamada medible de nuestro lado, fuera del set de proveedores trackeables.
export const STT_PROVIDERS = {
  groq:   { name: 'Groq Whisper (recomendado — rápido, multilingual)', label: 'Groq API Key', placeholder: 'gsk_...', models: ['whisper-large-v3-turbo'], needsKey: true },
  openai: { name: 'OpenAI (preciso)', label: 'OpenAI API Key', placeholder: 'sk-...', models: ['gpt-4o-mini-transcribe', 'whisper-1'], needsKey: true },
  'whisper-local': { name: 'Whisper local / whisper.cpp (gratis, sin internet)', label: null, placeholder: null, models: [], needsKey: false },
}

export const SETTINGS_CATEGORIES = [
  { id: 'general',    label: 'General',              icon: '⚙' },
  { id: 'llm',        label: 'LLM',                  icon: '🧠' },
  { id: 'embedding',  label: 'Embedding',             icon: '🔗' },
  { id: 'stt',        label: 'Speech to Text',        icon: '🎙' },
  { id: 'ingesta',    label: 'Ingesta',               icon: '📥' },
  { id: 'reference',  label: 'Papers de referencia',  icon: '📚' },
]

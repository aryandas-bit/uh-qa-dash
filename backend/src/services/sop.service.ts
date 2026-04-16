import fs from 'fs';
import path from 'path';

const sopsPath = process.env.SOPS_PATH
  || path.resolve(process.cwd(), '../all_sops.json');

let didWarnMissingSops = false;

export interface SOP {
  title: string;
  caseIdentifier: string;
  description: string;
  category: string;
  isActive: boolean;
  steps: Array<{
    id: string;
    stepNumber: number;
    title: string;
    macroName?: string;
    description: string;
    instructions: string[];
    conditions?: {
      conditionText: string;
      ifTrue: string;
      ifFalse: string;
    };
    isEndStep?: boolean;
    resolution?: string;
  }>;
}

let sopsCache: SOP[] | null = null;

export function loadSOPs(): SOP[] {
  if (sopsCache) {
    return sopsCache;
  }

  try {
    const content = fs.readFileSync(sopsPath, 'utf-8');
    sopsCache = JSON.parse(content) as SOP[];
    console.log(`Loaded ${sopsCache.length} SOPs`);
    return sopsCache;
  } catch (error) {
    if (!didWarnMissingSops) {
      console.warn(`SOP file not loaded from ${sopsPath}. Continuing without SOP matching.`);
      didWarnMissingSops = true;
    }
    return [];
  }
}

export function findMatchingSOP(category?: string, tags?: string): SOP | null {
  const sops = loadSOPs();
  if (sops.length === 0) return null;

  // Keywords to match from category or tags
  const searchTerms = [
    category?.toLowerCase(),
    ...(tags?.toLowerCase().split(',').map(t => t.trim()) || [])
  ].filter(Boolean);

  if (searchTerms.length === 0) return null;

  // Try to find matching SOP
  for (const sop of sops) {
    if (!sop.isActive) continue;

    const sopText = `${sop.title} ${sop.caseIdentifier} ${sop.description} ${sop.category}`.toLowerCase();

    for (const term of searchTerms) {
      if (term && sopText.includes(term)) {
        return sop;
      }
    }
  }

  // Check for common patterns
  const commonPatterns: Record<string, string[]> = {
    'dead on arrival': ['doa', 'won\'t start', 'not starting', 'new ring', 'pairing'],
    'battery': ['battery', 'drain', 'charging', 'charge'],
    'ring disconnection': ['disconnect', 'connection', 'bluetooth', 'sync'],
    'data': ['data', 'upload', 'sync', 'missing data'],
    'steps': ['steps', 'step count', 'walking', 'activity']
  };

  for (const [sopTitle, patterns] of Object.entries(commonPatterns)) {
    if (searchTerms.some(term => term && patterns.some(p => term.includes(p)))) {
      const matchedSOP = sops.find(s =>
        s.isActive && s.title.toLowerCase().includes(sopTitle.toLowerCase())
      );
      if (matchedSOP) return matchedSOP;
    }
  }

  return null;
}

export function getAllSOPs(): SOP[] {
  return loadSOPs().filter(sop => sop.isActive);
}

export function getSOPByTitle(title: string): SOP | null {
  const sops = loadSOPs();
  return sops.find(sop => sop.title.toLowerCase() === title.toLowerCase()) || null;
}

export function getSOPCategories(): string[] {
  const sops = loadSOPs();
  const categories = new Set<string>();

  sops.forEach(sop => {
    if (sop.category) {
      categories.add(sop.category);
    }
  });

  return Array.from(categories);
}

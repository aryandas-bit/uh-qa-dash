import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// SOPs are sourced from https://cxcodex.vercel.app/cx-codex (CX Codex)
// src/data/sops.json is the current snapshot — update it when CX Codex SOPs change.
const defaultSopsPath = path.join(fileURLToPath(import.meta.url), '../../data/sops.json');
const sopsPath = process.env.SOPS_PATH || defaultSopsPath;

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
    console.log(`Loaded ${sopsCache.length} SOPs from ${sopsPath}`);
    return sopsCache;
  } catch (error) {
    console.error('Failed to load SOPs:', error);
    return [];
  }
}

// --- category / keyword mapping -----------------------------------------------
// Maps ticket GROUP_NAME values (and common tag terms) to CX Codex SOP categories.
const CATEGORY_MAP: Record<string, string> = {
  // account — check before ring-issues so "data migration" doesn't get pulled into ring-issues
  'account': 'account-issues',
  'migration': 'account-issues',
  'transfer account': 'account-issues',
  'account transfer': 'account-issues',
  // ring hardware/software
  'ring': 'ring-issues',
  'hardware': 'ring-issues',
  'charger': 'ring-issues',
  'battery': 'ring-issues',
  'bluetooth': 'ring-issues',
  'not connecting': 'ring-issues',
  'disconnection': 'ring-issues',
  'doa': 'ring-issues',
  'dead on arrival': 'ring-issues',
  'sensor': 'ring-issues',
  'sleep': 'ring-issues',
  'steps count': 'ring-issues',
  'movement index': 'ring-issues',
  'charging': 'ring-issues',
  'data upload': 'ring-issues',
  'not uploading': 'ring-issues',
  'sync': 'ring-issues',
  // ops / general
  'ops': 'general',
  'order': 'general',
  'shipping': 'general',
  'delivery': 'general',
  'customs': 'general',
  'refund': 'general',
  'finance': 'general',
  'payment': 'general',
  'invoice': 'general',
  'gst': 'general',
  'legal': 'general',
  'fraud': 'general',
  'escalation': 'general',
  'flag': 'general',
  'label': 'general',
  'return': 'general',
  'replacement': 'general',
  'address change': 'general',
  'reroute': 'general',
  // home device
  'ultrahuman home': 'ultrahuman-home',
  'home device': 'ultrahuman-home',
};

function inferCategory(category?: string, tags?: string): string | null {
  const text = `${category || ''} ${tags || ''}`.toLowerCase();
  for (const [keyword, cat] of Object.entries(CATEGORY_MAP)) {
    if (text.includes(keyword)) return cat;
  }
  return null;
}

// SOP-level title/description keyword matching
function sopTextScore(sop: SOP, searchTerms: string[]): number {
  const sopText = `${sop.title} ${sop.caseIdentifier} ${sop.description} ${sop.category}`.toLowerCase();
  return searchTerms.filter(t => t && sopText.includes(t)).length;
}

export function findMatchingSOP(category?: string, tags?: string): SOP | null {
  const sops = loadSOPs();
  if (sops.length === 0) return null;

  const searchTerms = [
    ...(category?.toLowerCase().split(/[\s,/]+/) || []),
    ...(tags?.toLowerCase().split(/[\s,/]+/) || []),
  ].filter(t => t && t.length > 2);

  if (searchTerms.length === 0) return null;

  const activeSops = sops.filter(s => s.isActive);

  // 1. Try to narrow by inferred category first, then score within that bucket
  const inferredCat = inferCategory(category, tags);
  const bucket = inferredCat ? activeSops.filter(s => s.category === inferredCat) : activeSops;

  const scored = bucket
    .map(sop => ({ sop, score: sopTextScore(sop, searchTerms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) return scored[0].sop;

  // 2. Fall back to full scan if category bucket gave nothing
  if (inferredCat) {
    const fallback = activeSops
      .map(sop => ({ sop, score: sopTextScore(sop, searchTerms) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    if (fallback.length > 0) return fallback[0].sop;
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
    if (sop.category) categories.add(sop.category);
  });
  return Array.from(categories);
}

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import type { LevelsData, LevelData } from './types';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3003;

app.use(cors());
app.use(express.json());

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LEVELS_FILE = path.join(DATA_DIR, 'levels.json');

function loadLevels(): LevelsData {
  try {
    const raw = fs.readFileSync(LEVELS_FILE, 'utf-8');
    return JSON.parse(raw) as LevelsData;
  } catch (err) {
    console.error('Failed to load levels:', err);
    return { levels: [] };
  }
}

function saveLevels(data: LevelsData): boolean {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(LEVELS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to save levels:', err);
    return false;
  }
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b > 0.0001) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

const HARMONIC_MAX_DENOMINATOR = 10;
const HARMONIC_ERROR_THRESHOLD = 0.02;

interface HarmonicResult {
  isHarmonic: boolean;
  ratio: [number, number];
  error: number;
  maxDenominator: number;
  errorThreshold: number;
}

function validateHarmonicRatio(
  f1: number,
  f2: number,
  maxDenominator: number = HARMONIC_MAX_DENOMINATOR,
  errorThreshold: number = HARMONIC_ERROR_THRESHOLD
): HarmonicResult {
  const maxF = Math.max(f1, f2);
  const minF = Math.min(f1, f2);

  if (minF < 0.0001) {
    return {
      isHarmonic: false,
      ratio: [1, 1],
      error: Infinity,
      maxDenominator,
      errorThreshold
    };
  }

  const actualRatio = maxF / minF;
  let bestResult: HarmonicResult = {
    isHarmonic: false,
    ratio: [1, Math.round(actualRatio)],
    error: Infinity,
    maxDenominator,
    errorThreshold
  };

  for (let denom = 1; denom <= maxDenominator; denom++) {
    for (let numer = 1; numer <= maxDenominator; numer++) {
      const expectedRatio = numer / denom;
      const error = Math.abs(actualRatio - expectedRatio);

      if (error < bestResult.error) {
        bestResult = {
          isHarmonic: error <= errorThreshold,
          ratio: [denom, numer],
          error,
          maxDenominator,
          errorThreshold
        };
      }
    }
  }

  if (f1 > f2) {
    return {
      ...bestResult,
      ratio: [bestResult.ratio[1], bestResult.ratio[0]] as [number, number]
    };
  }

  return bestResult;
}

function isSimpleFrequencyRatio(f1: number, f2: number, maxDenom: number = 10): boolean {
  const result = validateHarmonicRatio(f1, f2, maxDenom, HARMONIC_ERROR_THRESHOLD);
  return result.isHarmonic;
}

app.get('/api/levels', (_req, res) => {
  const data = loadLevels();
  res.json({
    success: true,
    total: data.levels.length,
    levels: data.levels.map((l: LevelData) => ({
      id: l.id,
      name: l.name,
      creatureName: l.creatureName
    }))
  });
});

app.get('/api/levels/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const data = loadLevels();
  const level = data.levels.find((l: LevelData) => l.id === id);

  if (!level) {
    res.status(404).json({
      success: false,
      error: `Level ${id} not found`
    });
    return;
  }

  res.json({
    success: true,
    level
  });
});

app.get('/api/levels/:id/verify', (req, res) => {
  const id = parseInt(req.params.id);
  const edgeParam = req.query.edge as string;

  if (!edgeParam) {
    res.status(400).json({
      success: false,
      error: 'Missing edge parameter'
    });
    return;
  }

  const [from, to] = edgeParam.split('-');
  if (!from || !to) {
    res.status(400).json({
      success: false,
      error: 'Invalid edge format, expected from-to'
    });
    return;
  }

  const data = loadLevels();
  const level = data.levels.find((l: LevelData) => l.id === id);

  if (!level) {
    res.status(404).json({
      success: false,
      error: `Level ${id} not found`
    });
    return;
  }

  const fromPoint = level.anchorPoints.find(p => p.id === from);
  const toPoint = level.anchorPoints.find(p => p.id === to);

  if (!fromPoint || !toPoint) {
    res.json({
      success: true,
      valid: false,
      reason: 'Unknown anchor point'
    });
    return;
  }

  const isDefinedEdge = level.edges.some(
    e => (e.from === from && e.to === to) || (e.from === to && e.to === from)
  );

  const f1 = fromPoint.frequency;
  const f2 = toPoint.frequency;
  const harmonicResult = validateHarmonicRatio(f1, f2, HARMONIC_MAX_DENOMINATOR, HARMONIC_ERROR_THRESHOLD);

  res.json({
    success: true,
    valid: isDefinedEdge && harmonicResult.isHarmonic,
    isHarmonic: harmonicResult.isHarmonic,
    isDefinedEdge,
    frequencies: {
      [from]: f1,
      [to]: f2
    },
    ratio: harmonicResult.isHarmonic ? harmonicResult.ratio : null,
    harmonicError: harmonicResult.error,
    harmonicErrorThreshold: HARMONIC_ERROR_THRESHOLD,
    maxDenominator: HARMONIC_MAX_DENOMINATOR
  });
});

app.post('/api/levels', (req, res) => {
  const newLevel = req.body as LevelData;

  if (!newLevel.id || !newLevel.anchorPoints || !newLevel.edges) {
    res.status(400).json({
      success: false,
      error: 'Invalid level data'
    });
    return;
  }

  const invalidEdges: string[] = [];
  for (const edge of newLevel.edges) {
    const fromP = newLevel.anchorPoints.find(p => p.id === edge.from);
    const toP = newLevel.anchorPoints.find(p => p.id === edge.to);
    if (!fromP || !toP) {
      invalidEdges.push(`${edge.from}→${edge.to}: 星点不存在`);
      continue;
    }
    const result = validateHarmonicRatio(fromP.frequency, toP.frequency, HARMONIC_MAX_DENOMINATOR, HARMONIC_ERROR_THRESHOLD);
    if (!result.isHarmonic) {
      invalidEdges.push(`${edge.from}→${edge.to}: 频率 ${fromP.frequency}Hz 和 ${toP.frequency}Hz 不是简单谐波 (误差 ${(result.error * 100).toFixed(4)}% > ${HARMONIC_ERROR_THRESHOLD * 100}%)`);
    }
  }

  if (invalidEdges.length > 0) {
    res.status(400).json({
      success: false,
      error: `有 ${invalidEdges.length} 条连线不满足谐波条件`,
      invalidEdges,
      harmonicErrorThreshold: HARMONIC_ERROR_THRESHOLD,
      maxDenominator: HARMONIC_MAX_DENOMINATOR
    });
    return;
  }

  const data = loadLevels();
  const existing = data.levels.findIndex(l => l.id === newLevel.id);

  if (existing >= 0) {
    data.levels[existing] = newLevel;
  } else {
    data.levels.push(newLevel);
  }

  if (saveLevels(data)) {
    res.json({
      success: true,
      level: newLevel,
      harmonicValidation: {
        errorThreshold: HARMONIC_ERROR_THRESHOLD,
        maxDenominator: HARMONIC_MAX_DENOMINATOR,
        totalEdges: newLevel.edges.length,
        allHarmonic: true
      }
    });
  } else {
    res.status(500).json({
      success: false,
      error: 'Failed to save level'
    });
  }
});

app.get('/api/health', (_req, res) => {
  const data = loadLevels();
  res.json({
    success: true,
    status: 'running',
    port: PORT,
    levelsLoaded: data.levels.length
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✨ 星座游戏服务器启动成功`);
  console.log(`📡 服务地址: http://localhost:${PORT}`);
  console.log(`📊 健康检查: http://localhost:${PORT}/api/health`);
  console.log(`🎮 关卡数量: ${loadLevels().levels.length}\n`);
});

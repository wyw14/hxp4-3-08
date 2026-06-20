import type {
  AnchorPoint,
  ConstellationEdge,
  LevelData,
  ScreenPoint,
  BackgroundStar
} from './types';
import {
  generateBackgroundStars,
  distance,
  rotatePoint,
  validateHarmonicRatio,
  HARMONIC_ERROR_THRESHOLD,
  HARMONIC_MAX_DENOMINATOR,
  type HarmonicResult
} from './utils';

type ToolMode = 'place' | 'select' | 'connect';

interface EditorState {
  tool: ToolMode;
  anchorPoints: AnchorPoint[];
  edges: ConstellationEdge[];
  selectedPointId: string | null;
  draggingPointId: string | null;
  connectingFromId: string | null;
  hoverPointId: string | null;
}

const SNAP_DISTANCE = 25;

class LevelEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = 0;
  private height: number = 0;
  private backgroundStars: BackgroundStar[] = [];
  private time: number = 0;
  private animationFrameId: number = 0;

  private state: EditorState = {
    tool: 'place',
    anchorPoints: [],
    edges: [],
    selectedPointId: null,
    draggingPointId: null,
    connectingFromId: null,
    hoverPointId: null
  };

  private pointCounter: { anchor: number; helper: number } = { anchor: 0, helper: 0 };
  private currentAnchorType: 'a' | 'b' | 'c' = 'a';
  private currentHelperType: 'd' | 'e' | 'f' = 'd';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    this.ctx = ctx;
    this.resize();
    this.bindEvents();
    this.bindUIEvents();
    this.start();
    this.updateUI();
  }

  private resize(): void {
    const container = this.canvas.parentElement!;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    this.width = w;
    this.height = h;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.backgroundStars = generateBackgroundStars(300, w, h);
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this.handleMouseUp());
    this.canvas.addEventListener('mouseleave', () => this.handleMouseUp());

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private getCanvasPos(e: MouseEvent): ScreenPoint {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  private getRelativePos(screenPos: ScreenPoint): { x: number; y: number } {
    const maxDim = Math.min(this.width, this.height) * 0.9;
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    return {
      x: (screenPos.x - centerX) / maxDim + 0.5,
      y: (screenPos.y - centerY) / maxDim + 0.5
    };
  }

  private getScreenPos(anchor: AnchorPoint): ScreenPoint {
    const maxDim = Math.min(this.width, this.height) * 0.9;
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    return {
      x: centerX + (anchor.x - 0.5) * maxDim,
      y: centerY + (anchor.y - 0.5) * maxDim
    };
  }

  private findPointAt(pos: ScreenPoint): AnchorPoint | null {
    for (const anchor of this.state.anchorPoints) {
      const screenPos = this.getScreenPos(anchor);
      const d = distance(pos, screenPos);
      if (d < SNAP_DISTANCE) {
        return anchor;
      }
    }
    return null;
  }

  private handleMouseDown(e: MouseEvent): void {
    const pos = this.getCanvasPos(e);
    const point = this.findPointAt(pos);

    if (e.button === 2) {
      this.state.connectingFromId = null;
      this.updateCanvasHint();
      return;
    }

    switch (this.state.tool) {
      case 'place':
        if (!point) {
          this.addPoint(pos);
        } else {
          this.selectPoint(point.id);
        }
        break;

      case 'select':
        if (point) {
          this.state.draggingPointId = point.id;
          this.selectPoint(point.id);
        } else {
          this.selectPoint(null);
        }
        break;

      case 'connect':
        if (point) {
          if (!this.state.connectingFromId) {
            this.state.connectingFromId = point.id;
            this.updateCanvasHint();
          } else if (this.state.connectingFromId !== point.id) {
            this.addEdge(this.state.connectingFromId, point.id);
            this.state.connectingFromId = null;
            this.updateCanvasHint();
          }
        }
        break;
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    const pos = this.getCanvasPos(e);
    const point = this.findPointAt(pos);
    this.state.hoverPointId = point?.id ?? null;

    if (this.state.draggingPointId) {
      const rel = this.getRelativePos(pos);
      const anchor = this.state.anchorPoints.find(a => a.id === this.state.draggingPointId);
      if (anchor) {
        anchor.x = Math.max(0, Math.min(1, rel.x));
        anchor.y = Math.max(0, Math.min(1, rel.y));
        this.updateSelectedPointInputs();
      }
    }

    this.canvas.style.cursor = point ? 'pointer' : 'crosshair';
  }

  private handleMouseUp(): void {
    if (this.state.draggingPointId) {
      this.state.draggingPointId = null;
      this.updateUI();
    }
  }

  private addPoint(pos: ScreenPoint): void {
    const rel = this.getRelativePos(pos);
    const isAnchor = this.state.tool === 'place';

    let id: string;
    if (isAnchor) {
      this.pointCounter.anchor++;
      id = `${this.currentAnchorType}${this.pointCounter.anchor}`;
    } else {
      this.pointCounter.helper++;
      id = `${this.currentHelperType}${this.pointCounter.helper}`;
    }

    const newPoint: AnchorPoint = {
      id,
      x: Math.max(0, Math.min(1, rel.x)),
      y: Math.max(0, Math.min(1, rel.y)),
      frequency: 1.0,
      name: isAnchor ? `星点${this.pointCounter.anchor}` : `辅星${this.pointCounter.helper}`,
      baseBrightness: isAnchor ? 0.8 : 0.5,
      size: isAnchor ? 3.5 : 2.0
    };

    this.state.anchorPoints.push(newPoint);
    this.selectPoint(newPoint.id);
    this.showToast('已添加星点 ' + id, 'success');
  }

  private selectPoint(id: string | null): void {
    this.state.selectedPointId = id;
    this.updateUI();
  }

  private deletePoint(id: string): void {
    this.state.anchorPoints = this.state.anchorPoints.filter(p => p.id !== id);
    this.state.edges = this.state.edges.filter(e => e.from !== id && e.to !== id);
    if (this.state.selectedPointId === id) {
      this.state.selectedPointId = null;
    }
    if (this.state.connectingFromId === id) {
      this.state.connectingFromId = null;
    }
    this.showToast('已删除星点 ' + id, 'success');
    this.updateUI();
  }

  private addEdge(from: string, to: string): void {
    const exists = this.state.edges.some(
      e => (e.from === from && e.to === to) || (e.from === to && e.to === from)
    );
    if (exists) {
      this.showToast('该连线已存在', 'error');
      return;
    }

    const fromPoint = this.state.anchorPoints.find(p => p.id === from);
    const toPoint = this.state.anchorPoints.find(p => p.id === to);
    if (!fromPoint || !toPoint) return;

    const f1 = fromPoint.frequency;
    const f2 = toPoint.frequency;
    const result = this.validateHarmonic(f1, f2);

    this.state.edges.push({
      from,
      to,
      frequencyRatio: result.ratio
    });

    if (result.isHarmonic) {
      const errorPct = (result.error * 100).toFixed(2);
      this.showToast(`已添加连线 ${from}→${to} (比例 ${result.ratio[0]}:${result.ratio[1]}, 误差 ${errorPct}%)`, 'success');
    } else {
      const errorPct = (result.error * 100).toFixed(2);
      this.showToast(`频率 ${f1}Hz 和 ${f2}Hz 不是简单谐波 (误差 ${errorPct}% > ${HARMONIC_ERROR_THRESHOLD * 100}%)`, 'error');
    }
    this.updateUI();
  }

  private deleteEdge(index: number): void {
    this.state.edges.splice(index, 1);
    this.updateUI();
  }

  private validateHarmonic(f1: number, f2: number): HarmonicResult {
    return validateHarmonicRatio(f1, f2, HARMONIC_MAX_DENOMINATOR, HARMONIC_ERROR_THRESHOLD);
  }

  private bindUIEvents(): void {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.tool = (btn as HTMLElement).dataset.tool as ToolMode;
        this.state.connectingFromId = null;
        this.updateCanvasHint();
      });
    });

    document.querySelectorAll('.type-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.type-toggle button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const type = (btn as HTMLElement).dataset.type;
        if (type === 'anchor') {
          const selected = this.state.selectedPointId;
          if (selected) {
            const point = this.state.anchorPoints.find(p => p.id === selected);
            if (point) {
              point.baseBrightness = 0.8;
              point.size = 3.5;
              this.updateSelectedPointInputs();
              this.updateUI();
            }
          }
        } else {
          const selected = this.state.selectedPointId;
          if (selected) {
            const point = this.state.anchorPoints.find(p => p.id === selected);
            if (point) {
              point.baseBrightness = 0.5;
              point.size = 2.0;
              this.updateSelectedPointInputs();
              this.updateUI();
            }
          }
        }
      });
    });

    const bindInput = (id: string, callback: (val: string) => void) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', (e) => callback((e.target as HTMLInputElement).value));
      }
    };

    const levelInputs = ['level-id', 'level-name', 'creature-name', 'creature-desc'];
    levelInputs.forEach(id => {
      bindInput(id, () => this.updatePlayableChecks());
    });

    bindInput('point-name', (v) => {
      const p = this.getSelectedPoint();
      if (p) { p.name = v; this.updateUI(); }
    });
    bindInput('point-freq', (v) => {
      const p = this.getSelectedPoint();
      if (p) {
        p.frequency = parseFloat(v) || 1;
        this.recalculateEdgeRatios(p.id);
        this.updateUI();
      }
    });
    bindInput('point-size', (v) => {
      const p = this.getSelectedPoint();
      if (p) { p.size = parseFloat(v) || 3; this.updateUI(); }
    });
    bindInput('point-x', (v) => {
      const p = this.getSelectedPoint();
      if (p) { p.x = Math.max(0, Math.min(1, parseFloat(v) || 0)); this.updateUI(); }
    });
    bindInput('point-y', (v) => {
      const p = this.getSelectedPoint();
      if (p) { p.y = Math.max(0, Math.min(1, parseFloat(v) || 0)); this.updateUI(); }
    });
    bindInput('point-brightness', (v) => {
      const p = this.getSelectedPoint();
      if (p) { p.baseBrightness = Math.max(0, Math.min(1, parseFloat(v) || 0.7)); this.updateUI(); }
    });

    document.getElementById('btn-preview')?.addEventListener('click', () => {
      const preview = document.getElementById('json-preview');
      if (preview) {
        if (preview.style.display === 'none') {
          preview.style.display = 'block';
          preview.textContent = JSON.stringify(this.buildLevelDataForPreview(), null, 2);
        } else {
          preview.style.display = 'none';
        }
      }
    });

    document.getElementById('btn-copy')?.addEventListener('click', async () => {
      const json = JSON.stringify(this.buildLevelData(), null, 2);
      try {
        await navigator.clipboard.writeText(json);
        this.showToast('已复制到剪贴板', 'success');
      } catch {
        this.showToast('复制失败', 'error');
      }
    });

    document.getElementById('btn-save')?.addEventListener('click', () => this.saveToBackend());
  }

  private recalculateEdgeRatios(pointId: string): void {
    for (const edge of this.state.edges) {
      if (edge.from === pointId || edge.to === pointId) {
        const fromP = this.state.anchorPoints.find(p => p.id === edge.from);
        const toP = this.state.anchorPoints.find(p => p.id === edge.to);
        if (fromP && toP) {
          const result = this.validateHarmonic(fromP.frequency, toP.frequency);
          edge.frequencyRatio = result.ratio;
        }
      }
    }
  }

  private getSelectedPoint(): AnchorPoint | null {
    if (!this.state.selectedPointId) return null;
    return this.state.anchorPoints.find(p => p.id === this.state.selectedPointId) ?? null;
  }

  private updateSelectedPointInputs(): void {
    const p = this.getSelectedPoint();
    if (!p) return;
    (document.getElementById('point-name') as HTMLInputElement).value = p.name || '';
    (document.getElementById('point-freq') as HTMLInputElement).value = String(p.frequency);
    (document.getElementById('point-size') as HTMLInputElement).value = String(p.size ?? 3);
    (document.getElementById('point-x') as HTMLInputElement).value = p.x.toFixed(3);
    (document.getElementById('point-y') as HTMLInputElement).value = p.y.toFixed(3);
    (document.getElementById('point-brightness') as HTMLInputElement).value = String(p.baseBrightness ?? 0.7);
  }

  private updateCanvasHint(): void {
    const hint = document.getElementById('canvas-hint');
    if (!hint) return;
    switch (this.state.tool) {
      case 'place':
        hint.textContent = '点击画布空白处放置星点';
        break;
      case 'select':
        hint.textContent = '点击星点选中，拖动改变位置';
        break;
      case 'connect':
        hint.textContent = this.state.connectingFromId
          ? `已选择起点 ${this.state.connectingFromId}，点击另一个星点完成连线 (右键取消)`
          : '点击第一个星点作为连线起点';
        break;
    }
  }

  private updateUI(): void {
    this.updatePointsList();
    this.updateEdgesList();
    this.updatePlayableChecks();
    this.updateSelectedPointSection();
    this.updateCanvasHint();

    document.getElementById('points-count')!.textContent = String(this.state.anchorPoints.length);
    document.getElementById('edges-count')!.textContent = String(this.state.edges.length);
  }

  private updateSelectedPointSection(): void {
    const section = document.getElementById('selected-point-section');
    if (!section) return;

    if (this.state.selectedPointId) {
      section.style.display = 'block';
      this.updateSelectedPointInputs();
    } else {
      section.style.display = 'none';
    }
  }

  private updatePointsList(): void {
    const container = document.getElementById('point-list');
    if (!container) return;

    if (this.state.anchorPoints.length === 0) {
      container.innerHTML = '<div class="empty-hint">还没有星点，点击画布放置</div>';
      return;
    }

    container.innerHTML = '';
    for (const point of this.state.anchorPoints) {
      const isAnchor = point.id.startsWith('a') || point.id.startsWith('b') || point.id.startsWith('c');
      const div = document.createElement('div');
      div.className = 'point-item' + (this.state.selectedPointId === point.id ? ' selected' : '');
      div.innerHTML = `
        <div class="point-info">
          <div class="point-id">${point.id} ${isAnchor ? '★' : '☆'}</div>
          <div class="point-name">${point.name || '(未命名)'}</div>
          <div class="point-freq">${point.frequency.toFixed(1)} Hz · (${point.x.toFixed(2)}, ${point.y.toFixed(2)})</div>
        </div>
        <button class="delete-btn" data-id="${point.id}">删除</button>
      `;
      div.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('delete-btn')) return;
        this.selectPoint(point.id);
      });
      div.querySelector('.delete-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deletePoint(point.id);
      });
      container.appendChild(div);
    }
  }

  private updateEdgesList(): void {
    const container = document.getElementById('edge-list');
    if (!container) return;

    if (this.state.edges.length === 0) {
      container.innerHTML = '<div class="empty-hint">还没有连线，切换到"连接星脉"工具点击两个星点</div>';
      return;
    }

    container.innerHTML = '';
    this.state.edges.forEach((edge, idx) => {
      const fromP = this.state.anchorPoints.find(p => p.id === edge.from);
      const toP = this.state.anchorPoints.find(p => p.id === edge.to);
      const result = fromP && toP
        ? this.validateHarmonic(fromP.frequency, toP.frequency)
        : { isHarmonic: false, error: Infinity };
      const isHarmonic = result.isHarmonic;
      const fromName = fromP?.name || edge.from;
      const toName = toP?.name || edge.to;
      const errorPct = (result.error * 100).toFixed(2);
      const div = document.createElement('div');
      div.className = 'edge-item';
      div.innerHTML = `
        <div class="edge-info">
          <span class="edge-pair">${edge.from} → ${edge.to}</span>
          <span style="color:#667;">(${fromName} - ${toName})</span>
          <span class="edge-ratio ${isHarmonic ? 'harmonic' : 'disharmony'}">
            [${edge.frequencyRatio[0]}:${edge.frequencyRatio[1]}] ${isHarmonic ? '✓' : `✗ 误差${errorPct}%`}
          </span>
        </div>
        <button class="edge-delete" data-idx="${idx}">删</button>
      `;
      div.querySelector('.edge-delete')?.addEventListener('click', () => this.deleteEdge(idx));
      container.appendChild(div);
    });
  }

  private getValidation(): {
    hasEnoughPoints: boolean;
    hasEnoughEdges: boolean;
    allEdgesHarmonic: boolean;
    noDuplicateEdges: boolean;
    anchorsHaveEdges: boolean;
    hasLevelInfo: boolean;
    allGood: boolean;
  } {
    const anchorPoints = this.state.anchorPoints.filter(
      p => p.id.startsWith('a') || p.id.startsWith('b') || p.id.startsWith('c')
    );
    const hasEnoughPoints = anchorPoints.length >= 2;
    const hasEnoughEdges = this.state.edges.length >= 1;

    const allEdgesHarmonic = this.state.edges.every(e => {
      const fromP = this.state.anchorPoints.find(p => p.id === e.from);
      const toP = this.state.anchorPoints.find(p => p.id === e.to);
      if (!fromP || !toP) return false;
      const result = this.validateHarmonic(fromP.frequency, toP.frequency);
      return result.isHarmonic;
    });

    const edgeKeys = this.state.edges.map(e => [e.from, e.to].sort().join('-'));
    const noDuplicateEdges = new Set(edgeKeys).size === edgeKeys.length;

    const connectedAnchorIds = new Set<string>();
    for (const e of this.state.edges) {
      if (e.from.startsWith('a') || e.from.startsWith('b') || e.from.startsWith('c')) {
        connectedAnchorIds.add(e.from);
      }
      if (e.to.startsWith('a') || e.to.startsWith('b') || e.to.startsWith('c')) {
        connectedAnchorIds.add(e.to);
      }
    }
    const anchorsHaveEdges = anchorPoints.every(p => connectedAnchorIds.has(p.id)) || anchorPoints.length === 0;

    const levelId = (document.getElementById('level-id') as HTMLInputElement)?.value;
    const levelName = (document.getElementById('level-name') as HTMLInputElement)?.value;
    const creatureName = (document.getElementById('creature-name') as HTMLInputElement)?.value;
    const hasLevelInfo = !!(levelId && levelName && creatureName);

    const allGood = hasEnoughPoints && hasEnoughEdges && allEdgesHarmonic && noDuplicateEdges && anchorsHaveEdges && hasLevelInfo;

    return {
      hasEnoughPoints,
      hasEnoughEdges,
      allEdgesHarmonic,
      noDuplicateEdges,
      anchorsHaveEdges,
      hasLevelInfo,
      allGood
    };
  }

  private updatePlayableChecks(): void {
    const v = this.getValidation();

    const checks: Array<{ ok: boolean; text: string }> = [
      { ok: v.hasLevelInfo, text: '已填写关卡ID、名称、生物名称' },
      { ok: v.hasEnoughPoints, text: `至少有 2 个主星点 (当前 ${this.state.anchorPoints.filter(p => p.id.startsWith('a') || p.id.startsWith('b') || p.id.startsWith('c')).length})` },
      { ok: v.hasEnoughEdges, text: `至少有 1 条星脉连线 (当前 ${this.state.edges.length})` },
      { ok: v.allEdgesHarmonic, text: `所有连线频率都是简单谐波 (误差≤${HARMONIC_ERROR_THRESHOLD * 100}%, 分母≤${HARMONIC_MAX_DENOMINATOR})` },
      { ok: v.anchorsHaveEdges, text: '每个主星点至少参与一条连线' },
      { ok: v.noDuplicateEdges, text: '没有重复的连线' }
    ];

    const container = document.getElementById('check-list');
    if (container) {
      container.innerHTML = '';
      for (const c of checks) {
        const li = document.createElement('li');
        li.className = 'check-item';
        li.innerHTML = `
          <span class="check-icon ${c.ok ? 'ok' : 'err'}">${c.ok ? '✓' : '✗'}</span>
          <span class="check-text ${c.ok ? 'ok' : 'err'}">${c.text}</span>
        `;
        container.appendChild(li);
      }
    }

    const ps = document.getElementById('points-status');
    const es = document.getElementById('edges-status');
    const gs = document.getElementById('playable-status');
    const saveBtn = document.getElementById('btn-save') as HTMLButtonElement;

    if (ps) ps.className = 'status-dot ' + (v.hasEnoughPoints ? 'ok' : 'err');
    if (es) {
      es.className = 'status-dot ' + (v.hasEnoughEdges && v.allEdgesHarmonic && v.noDuplicateEdges ? 'ok' : (v.hasEnoughEdges ? 'warn' : 'err'));
    }
    if (gs) gs.className = 'status-dot ' + (v.allGood ? 'ok' : 'err');
    if (saveBtn) saveBtn.disabled = !v.allGood;
  }

  private buildLevelData(): LevelData {
    return {
      id: parseInt((document.getElementById('level-id') as HTMLInputElement).value) || 1,
      name: (document.getElementById('level-name') as HTMLInputElement).value || '未命名关卡',
      creatureName: (document.getElementById('creature-name') as HTMLInputElement).value || '未知生物',
      creatureDescription: (document.getElementById('creature-desc') as HTMLTextAreaElement).value || '',
      anchorPoints: this.state.anchorPoints.map(p => ({
        id: p.id,
        x: p.x,
        y: p.y,
        frequency: p.frequency,
        name: p.name,
        baseBrightness: p.baseBrightness,
        size: p.size
      })),
      edges: this.state.edges.map(e => ({
        from: e.from,
        to: e.to,
        frequencyRatio: e.frequencyRatio
      })),
      lightPollution: {
        baseIntensity: 0.12,
        variability: 0.08,
        speed: 0.3
      },
      rotationSpeed: 0.00008
    };
  }

  private buildLevelDataForPreview(): object {
    const levelData = this.buildLevelData();
    const edgesWithValidation = this.state.edges.map(e => {
      const fromP = this.state.anchorPoints.find(p => p.id === e.from);
      const toP = this.state.anchorPoints.find(p => p.id === e.to);
      const result = fromP && toP
        ? this.validateHarmonic(fromP.frequency, toP.frequency)
        : null;
      return {
        ...e,
        _validation: result ? {
          isHarmonic: result.isHarmonic,
          error: `${(result.error * 100).toFixed(4)}%`,
          errorThreshold: `${HARMONIC_ERROR_THRESHOLD * 100}%`,
          maxDenominator: HARMONIC_MAX_DENOMINATOR,
          fromFrequency: fromP?.frequency,
          toFrequency: toP?.frequency
        } : null
      };
    });
    return {
      ...levelData,
      edges: edgesWithValidation,
      _validationSummary: {
        harmonicErrorThreshold: `${HARMONIC_ERROR_THRESHOLD * 100}%`,
        maxDenominator: HARMONIC_MAX_DENOMINATOR,
        totalEdges: this.state.edges.length,
        validHarmonicEdges: this.state.edges.filter(e => {
          const fromP = this.state.anchorPoints.find(p => p.id === e.from);
          const toP = this.state.anchorPoints.find(p => p.id === e.to);
          if (!fromP || !toP) return false;
          return this.validateHarmonic(fromP.frequency, toP.frequency).isHarmonic;
        }).length
      }
    };
  }

  private async saveToBackend(): Promise<void> {
    const validation = this.getValidation();

    const invalidEdges = this.state.edges.filter(e => {
      const fromP = this.state.anchorPoints.find(p => p.id === e.from);
      const toP = this.state.anchorPoints.find(p => p.id === e.to);
      if (!fromP || !toP) return true;
      const result = this.validateHarmonic(fromP.frequency, toP.frequency);
      return !result.isHarmonic;
    });

    if (invalidEdges.length > 0) {
      const details = invalidEdges.map(e => {
        const fromP = this.state.anchorPoints.find(p => p.id === e.from);
        const toP = this.state.anchorPoints.find(p => p.id === e.to);
        const result = fromP && toP ? this.validateHarmonic(fromP.frequency, toP.frequency) : null;
        return `${e.from}→${e.to} (误差${result ? (result.error * 100).toFixed(2) : '?'}%)`;
      }).join(', ');
      this.showToast(`保存失败：${invalidEdges.length} 条连线不满足谐波条件: ${details}`, 'error');
      return;
    }

    if (!validation.allGood) {
      this.showToast('保存失败：不满足可游玩条件，请检查右侧验证列表', 'error');
      return;
    }

    const data = this.buildLevelData();
    try {
      const res = await fetch('/api/levels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (result.success) {
        this.showToast(`关卡 "${data.name}" 保存成功！`, 'success');
      } else {
        this.showToast('保存失败: ' + (result.error || '未知错误'), 'error');
      }
    } catch {
      this.showToast('无法连接后端服务器，请先启动后端', 'error');
    }
  }

  private showToast(msg: string, type: 'success' | 'error' = 'success'): void {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast show ' + type;
    setTimeout(() => {
      toast.className = 'toast ' + type;
    }, 2000);
  }

  private start(): void {
    this.loop();
  }

  private loop(): void {
    this.time += 1 / 60;
    this.render();
    this.animationFrameId = requestAnimationFrame(() => this.loop());
  }

  private render(): void {
    this.clear();
    this.drawBackground();
    this.drawGrid();
    this.drawEdges();
    this.drawConnectingLine();
    this.drawAnchorPoints();
  }

  private clear(): void {
    this.ctx.fillStyle = '#02030a';
    this.ctx.fillRect(0, 0, this.width, this.height);

    const gradient = this.ctx.createRadialGradient(
      this.width / 2, this.height / 2, 0,
      this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.7
    );
    gradient.addColorStop(0, 'rgba(10, 15, 40, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 0, 10, 1)');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawBackground(): void {
    const center = { x: this.width / 2, y: this.height / 2 };

    for (const star of this.backgroundStars) {
      const rotated = rotatePoint(
        { x: star.x, y: star.y },
        { x: 0, y: 0 },
        0
      );

      const px = center.x + rotated.x * (0.3 + star.z * 0.8);
      const py = center.y + rotated.y * (0.3 + star.z * 0.8);

      if (px < -20 || px > this.width + 20 || py < -20 || py > this.height + 20) continue;

      const twinkle = Math.sin(this.time * star.twinkleSpeed + star.twinkleOffset);
      const brightness = star.baseBrightness * (0.6 + 0.4 * twinkle);

      this.ctx.beginPath();
      this.ctx.arc(px, py, star.size * 0.7, 0, Math.PI * 2);
      this.ctx.fillStyle = `${star.color}${this.alphaToHex(brightness * 0.5)}`;
      this.ctx.fill();
    }
  }

  private drawGrid(): void {
    const maxDim = Math.min(this.width, this.height) * 0.9;
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const left = centerX - maxDim / 2;
    const top = centerY - maxDim / 2;

    this.ctx.strokeStyle = 'rgba(100, 150, 255, 0.08)';
    this.ctx.lineWidth = 1;

    for (let i = 0; i <= 10; i++) {
      const x = left + (maxDim * i) / 10;
      const y = top + (maxDim * i) / 10;
      this.ctx.beginPath();
      this.ctx.moveTo(x, top);
      this.ctx.lineTo(x, top + maxDim);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(left, y);
      this.ctx.lineTo(left + maxDim, y);
      this.ctx.stroke();
    }

    this.ctx.strokeStyle = 'rgba(100, 150, 255, 0.2)';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(left, top, maxDim, maxDim);
  }

  private drawEdges(): void {
    for (const edge of this.state.edges) {
      const from = this.state.anchorPoints.find(p => p.id === edge.from);
      const to = this.state.anchorPoints.find(p => p.id === edge.to);
      if (!from || !to) continue;

      const fromPos = this.getScreenPos(from);
      const toPos = this.getScreenPos(to);
      const result = this.validateHarmonic(from.frequency, to.frequency);
      const isHarmonic = result.isHarmonic;

      this.ctx.beginPath();
      this.ctx.moveTo(fromPos.x, fromPos.y);
      this.ctx.lineTo(toPos.x, toPos.y);
      this.ctx.strokeStyle = isHarmonic ? 'rgba(255, 215, 100, 0.6)' : 'rgba(248, 113, 113, 0.5)';
      this.ctx.lineWidth = 2;
      this.ctx.lineCap = 'round';
      this.ctx.stroke();

      const midX = (fromPos.x + toPos.x) / 2;
      const midY = (fromPos.y + toPos.y) / 2;
      this.ctx.font = '11px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = isHarmonic ? 'rgba(255, 230, 150, 0.9)' : 'rgba(252, 165, 165, 0.9)';
      this.ctx.fillText(`${edge.frequencyRatio[0]}:${edge.frequencyRatio[1]}`, midX, midY - 6);
    }
  }

  private drawConnectingLine(): void {
    if (!this.state.connectingFromId || !this.state.hoverPointId) return;
    const from = this.state.anchorPoints.find(p => p.id === this.state.connectingFromId);
    const to = this.state.anchorPoints.find(p => p.id === this.state.hoverPointId);
    if (!from || !to || from.id === to.id) return;

    const fromPos = this.getScreenPos(from);
    const toPos = this.getScreenPos(to);
    const dash = Math.sin(this.time * 8) * 0.3 + 0.7;

    this.ctx.beginPath();
    this.ctx.moveTo(fromPos.x, fromPos.y);
    this.ctx.lineTo(toPos.x, toPos.y);
    this.ctx.strokeStyle = `rgba(160, 196, 255, ${dash})`;
    this.ctx.lineWidth = 3;
    this.ctx.setLineDash([8, 6]);
    this.ctx.lineCap = 'round';
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  private drawAnchorPoints(): void {
    for (const anchor of this.state.anchorPoints) {
      const pos = this.getScreenPos(anchor);
      const isAnchor = anchor.id.startsWith('a') || anchor.id.startsWith('b') || anchor.id.startsWith('c');
      const isSelected = this.state.selectedPointId === anchor.id;
      const isHover = this.state.hoverPointId === anchor.id;
      const isConnectFrom = this.state.connectingFromId === anchor.id;

      const twinkle = Math.sin(this.time * anchor.frequency * 0.8) * 0.2 + 0.8;
      const brightness = (anchor.baseBrightness ?? 0.7) * twinkle;
      const size = (anchor.size ?? 3) * (isSelected || isHover || isConnectFrom ? 1.5 : 1);

      const baseColor = isAnchor ? { r: 200, g: 220, b: 255 } : { r: 180, g: 180, b: 200 };

      const glowR = size * 6;
      const glow = this.ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowR);
      glow.addColorStop(0, `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${brightness * 0.4})`);
      glow.addColorStop(0.4, `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${brightness * 0.12})`);
      glow.addColorStop(1, `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, 0)`);
      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, glowR, 0, Math.PI * 2);
      this.ctx.fillStyle = glow;
      this.ctx.fill();

      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${brightness})`;
      this.ctx.fill();

      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, size * 0.4, 0, Math.PI * 2);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fill();

      if (isSelected) {
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, size * 2.5, 0, Math.PI * 2);
        this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 + Math.sin(this.time * 5) * 0.3})`;
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([4, 4]);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
      }

      if (isConnectFrom) {
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, size * 3, 0, Math.PI * 2);
        this.ctx.strokeStyle = `rgba(160, 196, 255, ${0.6 + Math.sin(this.time * 6) * 0.4})`;
        this.ctx.lineWidth = 3;
        this.ctx.stroke();
      }

      this.ctx.font = '10px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = isAnchor ? 'rgba(160, 196, 255, 0.85)' : 'rgba(150, 150, 170, 0.7)';
      this.ctx.fillText(anchor.id, pos.x, pos.y + size + 14);
      this.ctx.fillText(`${anchor.frequency.toFixed(1)}Hz`, pos.x, pos.y + size + 26);
    }
  }

  private alphaToHex(alpha: number): string {
    const clamped = Math.max(0, Math.min(1, alpha));
    return Math.round(clamped * 255).toString(16).padStart(2, '0');
  }

  destroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }
}

const canvas = document.getElementById('editorCanvas') as HTMLCanvasElement;
new LevelEditor(canvas);

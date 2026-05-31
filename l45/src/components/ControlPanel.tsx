import { useEffect, useRef } from 'react';
import GUI from 'lil-gui';
import { useSimulationStore } from '../store/simulationStore';
import { getSimulationManager } from '../ecs/SimulationManager';

export function ControlPanel() {
  const guiRef = useRef<GUI | null>(null);
  const simulation = getSimulationManager();
  const { setParams } = useSimulationStore();

  useEffect(() => {
    const gui = new GUI({
      title: '参数控制',
      width: 300,
    });
    guiRef.current = gui;

    const state = useSimulationStore.getState();

    const particleFolder = gui.addFolder('粒子参数');
    particleFolder.add(state, 'emissionRate', 0, 100, 1).name('发射率').onChange((v: number) => setParams({ emissionRate: v }));
    particleFolder.add(state, 'particleMass', 0.1, 5, 0.1).name('粒子质量').onChange((v: number) => setParams({ particleMass: v }));
    particleFolder.add(state, 'viscosity', 0.001, 0.1, 0.001).name('粘度系数').onChange((v: number) => setParams({ viscosity: v }));
    particleFolder.add(state, 'smoothingRadius', 0.05, 0.3, 0.01).name('平滑半径').onChange((v: number) => setParams({ smoothingRadius: v }));

    const erosionFolder = gui.addFolder('腐蚀参数');
    erosionFolder.add(state, 'erosionStrength', 0, 1, 0.01).name('溶蚀强度').onChange((v: number) => setParams({ erosionStrength: v }));
    erosionFolder.add(state, 'transportCoefficient', 0, 1, 0.01).name('搬运系数').onChange((v: number) => setParams({ transportCoefficient: v }));
    erosionFolder.add(state, 'depositionThreshold', 0, 1, 0.01).name('沉积阈值').onChange((v: number) => setParams({ depositionThreshold: v }));

    const physicsFolder = gui.addFolder('物理参数');
    physicsFolder.add(state, 'gravity', -20, 0, 0.1).name('重力').onChange((v: number) => setParams({ gravity: v }));
    physicsFolder.add(state, 'restDensity', 500, 2000, 50).name('静止密度').onChange((v: number) => setParams({ restDensity: v }));

    const displayFolder = gui.addFolder('显示选项');
    displayFolder.add(state, 'showParticles').name('显示粒子').onChange((v: boolean) => setParams({ showParticles: v }));
    displayFolder.add(state, 'showTerrainWireframe').name('地形线框').onChange((v: boolean) => setParams({ showTerrainWireframe: v }));

    const controlFolder = gui.addFolder('控制');
    controlFolder.add(state, 'isPaused').name('暂停').onChange((v: boolean) => setParams({ isPaused: v }));
    controlFolder.add({ reset: () => simulation.reset() }, 'reset').name('重置模拟');

    return () => {
      gui.destroy();
    };
  }, [setParams, simulation]);

  return null;
}

export type EntityId = number;

export interface Component {}

export interface PositionComponent extends Component {
  x: number;
  y: number;
  z: number;
}

export interface VelocityComponent extends Component {
  vx: number;
  vy: number;
  vz: number;
}

export interface MassComponent extends Component {
  value: number;
}

export interface ChemicalConcentrationComponent extends Component {
  value: number;
}

export interface HeightComponent extends Component {
  value: number;
  nx: number;
  ny: number;
  nz: number;
}

export interface ErosionLevelComponent extends Component {
  value: number;
  sediment: number;
}

export type ComponentType =
  | 'position'
  | 'velocity'
  | 'mass'
  | 'chemicalConcentration'
  | 'height'
  | 'erosionLevel';

export interface Entity {
  id: EntityId;
  components: Map<ComponentType, Component>;
}

export interface ISystem {
  name: string;
  update(deltaTime: number, world: World): void;
}

export interface World {
  entities: Map<EntityId, Entity>;
  systems: ISystem[];
  nextEntityId: EntityId;
  createEntity(): EntityId;
  addComponent(entityId: EntityId, type: ComponentType, component: Component): void;
  getComponent<T extends Component>(entityId: EntityId, type: ComponentType): T | undefined;
  removeEntity(entityId: EntityId): void;
  addSystem(system: ISystem): void;
  update(deltaTime: number): void;
  queryEntities(components: ComponentType[]): EntityId[];
}

import type {
  EntityId,
  Entity,
  Component,
  ComponentType,
  ISystem,
  World as IWorld,
} from '../types/ecs';

export class World implements IWorld {
  entities: Map<EntityId, Entity> = new Map();
  systems: ISystem[] = [];
  nextEntityId: EntityId = 0;

  createEntity(): EntityId {
    const id = this.nextEntityId++;
    this.entities.set(id, {
      id,
      components: new Map(),
    });
    return id;
  }

  addComponent(entityId: EntityId, type: ComponentType, component: Component): void {
    const entity = this.entities.get(entityId);
    if (entity) {
      entity.components.set(type, component);
    }
  }

  getComponent<T extends Component>(entityId: EntityId, type: ComponentType): T | undefined {
    const entity = this.entities.get(entityId);
    if (entity) {
      return entity.components.get(type) as T | undefined;
    }
    return undefined;
  }

  removeEntity(entityId: EntityId): void {
    this.entities.delete(entityId);
  }

  addSystem(system: ISystem): void {
    this.systems.push(system);
  }

  update(deltaTime: number): void {
    for (const system of this.systems) {
      system.update(deltaTime, this);
    }
  }

  queryEntities(components: ComponentType[]): EntityId[] {
    const result: EntityId[] = [];
    for (const [id, entity] of this.entities) {
      let hasAll = true;
      for (const comp of components) {
        if (!entity.components.has(comp)) {
          hasAll = false;
          break;
        }
      }
      if (hasAll) {
        result.push(id);
      }
    }
    return result;
  }
}

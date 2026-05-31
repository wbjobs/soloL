package service

import (
	"encoding/json"
	"errors"
	"sync"
	"vct-gi-system/models"
	"vct-gi-system/repository"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

type ObjectUpdateBroadcaster interface {
	BroadcastToScene(sceneID uuid.UUID, msg interface{})
}

type DynamicObjectService struct {
	objRepo     *repository.DynamicObjectRepository
	sceneRepo   *repository.SceneRepository
	broadcaster ObjectUpdateBroadcaster
	cache       map[uuid.UUID][]models.DynamicObject
	mu          sync.RWMutex
}

var (
	dynamicObjectServiceInstance *DynamicObjectService
	dynamicObjectServiceOnce     sync.Once
)

func NewDynamicObjectService(broadcaster ObjectUpdateBroadcaster) *DynamicObjectService {
	dynamicObjectServiceOnce.Do(func() {
		dynamicObjectServiceInstance = &DynamicObjectService{
			objRepo:     repository.NewDynamicObjectRepository(),
			sceneRepo:   repository.NewSceneRepository(),
			broadcaster: broadcaster,
			cache:       make(map[uuid.UUID][]models.DynamicObject),
		}
	})
	return dynamicObjectServiceInstance
}

func GetDynamicObjectService() *DynamicObjectService {
	return dynamicObjectServiceInstance
}

type ObjectCreateParams struct {
	Name       string                 `json:"name" binding:"required"`
	ObjectType string                 `json:"object_type" binding:"required"`
	Position   *models.Vector3        `json:"position"`
	Rotation   *models.Vector3        `json:"rotation"`
	Scale      *models.Vector3        `json:"scale"`
	MeshData   map[string]interface{} `json:"mesh_data"`
	Material   map[string]interface{} `json:"material"`
	IsStatic   bool                   `json:"is_static"`
}

type PositionUpdate struct {
	ID       uuid.UUID       `json:"id" binding:"required"`
	Position *models.Vector3 `json:"position" binding:"required"`
	Rotation *models.Vector3 `json:"rotation"`
}

type BatchPositionUpdateRequest struct {
	Updates []PositionUpdate `json:"updates" binding:"required,min=1"`
}

func (s *DynamicObjectService) CreateObject(sceneID, userID uuid.UUID, params ObjectCreateParams) (*models.DynamicObject, error) {
	owned, err := s.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		return nil, errors.New("access denied")
	}

	obj := &models.DynamicObject{
		ID:         uuid.Nil,
		SceneID:    sceneID,
		Name:       params.Name,
		ObjectType: params.ObjectType,
		IsStatic:   params.IsStatic,
	}

	if params.Position != nil {
		obj.Position = params.Position.ToJSON()
	} else {
		obj.Position = models.NewVector3(0, 0, 0).ToJSON()
	}

	if params.Rotation != nil {
		obj.Rotation = params.Rotation.ToJSON()
	} else {
		obj.Rotation = models.NewVector3(0, 0, 0).ToJSON()
	}

	if params.Scale != nil {
		obj.Scale = params.Scale.ToJSON()
	} else {
		obj.Scale = models.NewVector3(1, 1, 1).ToJSON()
	}

	if params.MeshData != nil {
		meshJSON, _ := json.Marshal(params.MeshData)
		obj.MeshData = datatypes.JSON(meshJSON)
	}

	if params.Material != nil {
		materialJSON, _ := json.Marshal(params.Material)
		obj.Material = datatypes.JSON(materialJSON)
	}

	if err := s.objRepo.Create(obj); err != nil {
		return nil, err
	}

	s.InvalidateCache(sceneID)

	s.broadcastObjectUpdate(sceneID, "object_created", obj)

	return obj, nil
}

func (s *DynamicObjectService) GetObject(objID, sceneID, userID uuid.UUID) (*models.DynamicObject, error) {
	owned, err := s.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		return nil, errors.New("access denied")
	}

	belongs, err := s.objRepo.BelongsToScene(objID, sceneID)
	if err != nil || !belongs {
		return nil, errors.New("object does not belong to scene")
	}

	return s.objRepo.GetByID(objID)
}

func (s *DynamicObjectService) ListObjects(sceneID, userID uuid.UUID, objectType string, staticOnly bool) ([]models.DynamicObject, error) {
	owned, err := s.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		return nil, errors.New("access denied")
	}

	var objs []models.DynamicObject
	var errObj error

	if staticOnly {
		objs, errObj = s.objRepo.GetStaticObjects(sceneID)
	} else if objectType != "" {
		objs, errObj = s.objRepo.GetBySceneIDWithType(sceneID, objectType)
	} else {
		s.mu.RLock()
		if cached, ok := s.cache[sceneID]; ok {
			s.mu.RUnlock()
			return cached, nil
		}
		s.mu.RUnlock()

		objs, errObj = s.objRepo.GetBySceneID(sceneID)
		if errObj == nil {
			s.mu.Lock()
			s.cache[sceneID] = objs
			s.mu.Unlock()
		}
	}

	return objs, errObj
}

func (s *DynamicObjectService) UpdateObject(objID, sceneID, userID uuid.UUID, params map[string]interface{}) (*models.DynamicObject, error) {
	owned, err := s.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		return nil, errors.New("access denied")
	}

	belongs, err := s.objRepo.BelongsToScene(objID, sceneID)
	if err != nil || !belongs {
		return nil, errors.New("object does not belong to scene")
	}

	obj, err := s.objRepo.GetByID(objID)
	if err != nil {
		return nil, errors.New("object not found")
	}

	if name, ok := params["name"].(string); ok {
		obj.Name = name
	}
	if objectType, ok := params["object_type"].(string); ok {
		obj.ObjectType = objectType
	}
	if position, ok := params["position"]; ok {
		obj.Position = toJSON(position)
	}
	if rotation, ok := params["rotation"]; ok {
		obj.Rotation = toJSON(rotation)
	}
	if scale, ok := params["scale"]; ok {
		obj.Scale = toJSON(scale)
	}
	if meshData, ok := params["mesh_data"]; ok {
		obj.MeshData = toJSON(meshData)
	}
	if material, ok := params["material"]; ok {
		obj.Material = toJSON(material)
	}
	if isStatic, ok := params["is_static"].(bool); ok {
		obj.IsStatic = isStatic
	}

	if err := s.objRepo.Update(obj); err != nil {
		return nil, err
	}

	s.InvalidateCache(sceneID)

	s.broadcastObjectUpdate(sceneID, "object_updated", obj)

	return obj, nil
}

func (s *DynamicObjectService) BatchUpdatePositions(sceneID, userID uuid.UUID, updates []PositionUpdate) (int, error) {
	owned, err := s.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		return 0, errors.New("access denied")
	}

	repoUpdates := make([]repository.ObjectPositionUpdate, 0, len(updates))
	updatedObjects := make([]*models.DynamicObject, 0, len(updates))

	for _, update := range updates {
		belongs, err := s.objRepo.BelongsToScene(update.ID, sceneID)
		if err != nil || !belongs {
			continue
		}

		repoUpdate := repository.ObjectPositionUpdate{
			ID:       update.ID,
			Position: update.Position.ToJSON(),
		}

		if update.Rotation != nil {
			repoUpdate.Rotation = update.Rotation.ToJSON()
		}

		repoUpdates = append(repoUpdates, repoUpdate)

		obj, _ := s.objRepo.GetByID(update.ID)
		if obj != nil {
			obj.Position = update.Position.ToJSON()
			if update.Rotation != nil {
				obj.Rotation = update.Rotation.ToJSON()
			}
			updatedObjects = append(updatedObjects, obj)
		}
	}

	if len(repoUpdates) == 0 {
		return 0, nil
	}

	if err := s.objRepo.BatchUpdatePositions(sceneID, repoUpdates); err != nil {
		return 0, err
	}

	s.InvalidateCache(sceneID)

	for _, obj := range updatedObjects {
		s.broadcastObjectUpdate(sceneID, "object_transform_updated", obj)
	}

	return len(repoUpdates), nil
}

func (s *DynamicObjectService) DeleteObject(objID, sceneID, userID uuid.UUID) error {
	owned, err := s.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		return errors.New("access denied")
	}

	belongs, err := s.objRepo.BelongsToScene(objID, sceneID)
	if err != nil || !belongs {
		return errors.New("object does not belong to scene")
	}

	if err := s.objRepo.Delete(objID); err != nil {
		return err
	}

	s.InvalidateCache(sceneID)

	s.broadcastObjectUpdate(sceneID, "object_deleted", map[string]interface{}{"id": objID})

	return nil
}

func (s *DynamicObjectService) InvalidateCache(sceneID uuid.UUID) {
	s.mu.Lock()
	delete(s.cache, sceneID)
	s.mu.Unlock()
}

type WebSocketMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

func (s *DynamicObjectService) broadcastObjectUpdate(sceneID uuid.UUID, updateType string, data interface{}) {
	s.broadcaster.BroadcastToScene(sceneID, WebSocketMessage{
		Type:    updateType,
		Payload: data,
	})
}

func toJSON(v interface{}) datatypes.JSON {
	data, _ := json.Marshal(v)
	return datatypes.JSON(data)
}

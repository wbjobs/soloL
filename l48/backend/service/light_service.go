package service

import (
	"encoding/json"
	"errors"
	"math"
	"sync"
	"vct-gi-system/models"
	"vct-gi-system/pkg/voxel"
	"vct-gi-system/repository"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

type LightUpdateBroadcaster interface {
	BroadcastLightUpdate(sceneID uuid.UUID, light *models.Light)
}

type LightService struct {
	lightRepo   *repository.LightRepository
	sceneRepo   *repository.SceneRepository
	voxelRepo   *repository.VoxelRepository
	broadcaster LightUpdateBroadcaster
	cache       map[uuid.UUID][]*models.Light
	mu          sync.RWMutex
}

var (
	lightServiceInstance *LightService
	lightServiceOnce     sync.Once
)

func NewLightService(broadcaster LightUpdateBroadcaster) *LightService {
	lightServiceOnce.Do(func() {
		lightServiceInstance = &LightService{
			lightRepo:   repository.NewLightRepository(),
			sceneRepo:   repository.NewSceneRepository(),
			voxelRepo:   repository.NewVoxelRepository(),
			broadcaster: broadcaster,
			cache:       make(map[uuid.UUID][]*models.Light),
		}
	})
	return lightServiceInstance
}

func GetLightService() *LightService {
	return lightServiceInstance
}

type LightUpdateParams struct {
	Position  *models.Vector3 `json:"position"`
	Direction *models.Vector3 `json:"direction"`
	Color     *models.Color   `json:"color"`
	Intensity *float64        `json:"intensity"`
	Radius    *float64        `json:"radius"`
	SpotAngle *float64        `json:"spot_angle"`
	Enabled   *bool           `json:"enabled"`
}

func (s *LightService) UpdateLightParameters(sceneID, lightID, userID uuid.UUID, params LightUpdateParams) (*models.Light, error) {
	owned, err := s.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		return nil, errors.New("access denied")
	}

	belongs, err := s.lightRepo.BelongsToScene(lightID, sceneID)
	if err != nil || !belongs {
		return nil, errors.New("light does not belong to scene")
	}

	light, err := s.lightRepo.GetByID(lightID)
	if err != nil {
		return nil, errors.New("light not found")
	}

	if params.Position != nil {
		light.Position = params.Position.ToJSON()
	}
	if params.Direction != nil {
		light.Direction = params.Direction.ToJSON()
	}
	if params.Color != nil {
		light.Color = params.Color.ToJSON()
	}
	if params.Intensity != nil {
		light.Intensity = *params.Intensity
	}
	if params.Radius != nil {
		light.Radius = *params.Radius
	}
	if params.SpotAngle != nil {
		light.SpotAngle = *params.SpotAngle
	}
	if params.Enabled != nil {
		light.Enabled = *params.Enabled
	}

	if err := s.lightRepo.Update(light); err != nil {
		return nil, errors.New("failed to update light")
	}

	s.mu.Lock()
	delete(s.cache, sceneID)
	s.mu.Unlock()

	s.broadcaster.BroadcastLightUpdate(sceneID, light)

	return light, nil
}

func (s *LightService) CalculatePointLightIrradiance(light *models.Light, position voxel.WorldCoord, grid *models.VoxelGrid) *models.Color {
	lightPos := s.parseVector3(light.Position)
	lightColor := s.parseColor(light.Color)

	toLight := voxel.WorldCoord{
		X: lightPos.X - position.X,
		Y: lightPos.Y - position.Y,
		Z: lightPos.Z - position.Z,
	}

	distance := math.Sqrt(toLight.X*toLight.X + toLight.Y*toLight.Y + toLight.Z*toLight.Z)
	if distance <= 0 || distance >= light.Radius {
		return &models.Color{R: 0, G: 0, B: 0}
	}

	attenuation := voxel.CalculateLightAttenuation(distance, light.Radius)
	toLight = voxel.WorldCoord{
		X: toLight.X / distance,
		Y: toLight.Y / distance,
		Z: toLight.Z / distance,
	}

	irradiance := &models.Color{
		R: lightColor.R * light.Intensity * attenuation,
		G: lightColor.G * light.Intensity * attenuation,
		B: lightColor.B * light.Intensity * attenuation,
	}

	return irradiance
}

func (s *LightService) CalculateSpotLightIrradiance(light *models.Light, position voxel.WorldCoord, grid *models.VoxelGrid) *models.Color {
	lightPos := s.parseVector3(light.Position)
	lightDir := s.parseVector3(light.Direction)
	lightColor := s.parseColor(light.Color)

	toLight := voxel.WorldCoord{
		X: lightPos.X - position.X,
		Y: lightPos.Y - position.Y,
		Z: lightPos.Z - position.Z,
	}

	distance := math.Sqrt(toLight.X*toLight.X + toLight.Y*toLight.Y + toLight.Z*toLight.Z)
	if distance <= 0 || distance >= light.Radius {
		return &models.Color{R: 0, G: 0, B: 0}
	}

	toLight = voxel.WorldCoord{
		X: toLight.X / distance,
		Y: toLight.Y / distance,
		Z: toLight.Z / distance,
	}

	spotFactor := voxel.CalculateSpotlightFactor(
		voxel.WorldCoord{X: -lightDir.X, Y: -lightDir.Y, Z: -lightDir.Z},
		toLight,
		light.SpotAngle,
	)

	if spotFactor <= 0 {
		return &models.Color{R: 0, G: 0, B: 0}
	}

	attenuation := voxel.CalculateLightAttenuation(distance, light.Radius)

	irradiance := &models.Color{
		R: lightColor.R * light.Intensity * attenuation * spotFactor,
		G: lightColor.G * light.Intensity * attenuation * spotFactor,
		B: lightColor.B * light.Intensity * attenuation * spotFactor,
	}

	return irradiance
}

func (s *LightService) CalculateDirectionalLightIrradiance(light *models.Light, position voxel.WorldCoord, grid *models.VoxelGrid) *models.Color {
	lightColor := s.parseColor(light.Color)

	irradiance := &models.Color{
		R: lightColor.R * light.Intensity,
		G: lightColor.G * light.Intensity,
		B: lightColor.B * light.Intensity,
	}

	return irradiance
}

func (s *LightService) CalculateTotalIrradiance(sceneID uuid.UUID, position voxel.WorldCoord) (*models.Color, error) {
	scene, err := s.sceneRepo.GetByIDWithLights(sceneID)
	if err != nil {
		return nil, errors.New("scene not found")
	}

	grid, err := s.voxelRepo.GetActiveGridBySceneID(sceneID)
	if err != nil {
		grid = nil
	}

	total := &models.Color{R: 0, G: 0, B: 0}

	for _, light := range scene.Lights {
		if !light.Enabled {
			continue
		}

		var irradiance *models.Color
		switch light.Type {
		case "point":
			irradiance = s.CalculatePointLightIrradiance(&light, position, grid)
		case "spot":
			irradiance = s.CalculateSpotLightIrradiance(&light, position, grid)
		case "directional":
			irradiance = s.CalculateDirectionalLightIrradiance(&light, position, grid)
		default:
			continue
		}

		total.R += irradiance.R
		total.G += irradiance.G
		total.B += irradiance.B
	}

	return total, nil
}

func (s *LightService) GetActiveLights(sceneID uuid.UUID) ([]models.Light, error) {
	s.mu.RLock()
	if cached, ok := s.cache[sceneID]; ok {
		result := make([]models.Light, len(cached))
		for i, l := range cached {
			result[i] = *l
		}
		s.mu.RUnlock()
		return result, nil
	}
	s.mu.RUnlock()

	lights, err := s.lightRepo.GetActiveBySceneID(sceneID)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	cached := make([]*models.Light, len(lights))
	for i := range lights {
		cached[i] = &lights[i]
	}
	s.cache[sceneID] = cached
	s.mu.Unlock()

	return lights, nil
}

func (s *LightService) InvalidateCache(sceneID uuid.UUID) {
	s.mu.Lock()
	delete(s.cache, sceneID)
	s.mu.Unlock()
}

func (s *LightService) parseVector3(data datatypes.JSON) voxel.WorldCoord {
	var vec models.Vector3
	if err := json.Unmarshal(data, &vec); err != nil {
		return voxel.WorldCoord{X: 0, Y: 0, Z: 0}
	}
	return voxel.WorldCoord{X: vec.X, Y: vec.Y, Z: vec.Z}
}

func (s *LightService) parseColor(data datatypes.JSON) *models.Color {
	var color models.Color
	if err := json.Unmarshal(data, &color); err != nil {
		return &models.Color{R: 1, G: 1, B: 1}
	}
	return &color
}

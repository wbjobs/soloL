package worker

import (
	"encoding/json"
	"errors"
	"math"
	"math/rand"
	"time"
	"vct-gi-system/models"
	"vct-gi-system/pkg/voxel"
	"vct-gi-system/repository"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

type BakeProgressNotifier interface {
	BroadcastBakeProgress(sceneID uuid.UUID, progress int, status string)
}

const (
	TaskStatusPending   = "pending"
	TaskStatusRunning   = "running"
	TaskStatusCompleted = "completed"
	TaskStatusFailed    = "failed"
	TaskStatusCancelled = "cancelled"
)

type BakeResult struct {
	VoxelData []models.VoxelData
}

type BakeWorker struct {
	task        *models.BakeTask
	notifier    BakeProgressNotifier
	cancelChan  chan struct{}
	bakeRepo    *repository.BakeRepository
	sceneRepo   *repository.SceneRepository
	lightRepo   *repository.LightRepository
	objRepo     *repository.DynamicObjectRepository
	voxelRepo   *repository.VoxelRepository
	useFallback bool
}

func NewBakeWorker(task *models.BakeTask, notifier BakeProgressNotifier, cancelChan chan struct{}) *BakeWorker {
	return &BakeWorker{
		task:        task,
		notifier:    notifier,
		cancelChan:  cancelChan,
		bakeRepo:    repository.NewBakeRepository(),
		sceneRepo:   repository.NewSceneRepository(),
		lightRepo:   repository.NewLightRepository(),
		objRepo:     repository.NewDynamicObjectRepository(),
		voxelRepo:   repository.NewVoxelRepository(),
		useFallback: true,
	}
}

func (w *BakeWorker) Process() (*BakeResult, error) {
	scene, err := w.sceneRepo.GetByID(w.task.SceneID)
	if err != nil {
		return nil, errors.New("scene not found")
	}

	lights, err := w.lightRepo.GetActiveBySceneID(w.task.SceneID)
	if err != nil {
		lights = []models.Light{}
	}

	objects, err := w.objRepo.GetStaticObjects(w.task.SceneID)
	if err != nil {
		objects = []models.DynamicObject{}
	}

	if w.useFallback {
		return w.processFallback(scene, lights, objects)
	}

	return w.processAdvanced(scene, lights, objects)
}

func (w *BakeWorker) processFallback(scene *models.Scene, lights []models.Light, objects []models.DynamicObject) (*BakeResult, error) {
	gridSizeX := w.task.GridSizeX
	gridSizeY := w.task.GridSizeY
	gridSizeZ := w.task.GridSizeZ
	resolution := w.task.Resolution
	totalVoxels := gridSizeX * gridSizeY * gridSizeZ

	origin := w.parseVector3(scene.BoundsMin)

	voxelData := make([]models.VoxelData, 0, totalVoxels)
	processed := 0
	lastProgress := 0

	lightData := make([]struct {
		pos    voxel.WorldCoord
		dir    voxel.WorldCoord
		color  *models.Color
		typ    string
		inten  float64
		radius float64
		angle  float64
	}, len(lights))

	for i, light := range lights {
		lightData[i] = struct {
			pos    voxel.WorldCoord
			dir    voxel.WorldCoord
			color  *models.Color
			typ    string
			inten  float64
			radius float64
			angle  float64
		}{
			pos:    w.parseVector3(light.Position),
			dir:    w.parseVector3(light.Direction),
			color:  w.parseColor(light.Color),
			typ:    light.Type,
			inten:  light.Intensity,
			radius: light.Radius,
			angle:  light.SpotAngle,
		}
	}

	randGen := rand.New(rand.NewSource(time.Now().UnixNano()))

	for z := 0; z < gridSizeZ; z++ {
		for y := 0; y < gridSizeY; y++ {
			for x := 0; x < gridSizeX; x++ {
				select {
				case <-w.cancelChan:
					return nil, errors.New("task cancelled")
				default:
				}

				worldPos := voxel.VoxelToWorld(voxel.VoxelCoord{X: x, Y: y, Z: z}, origin, resolution)

				opacity := voxel.ComputeVoxelOpacity(objects, worldPos, resolution)

				irradiance := &models.Color{R: 0, G: 0, B: 0}
				direction := &models.Vector3{X: 0, Y: 0, Z: 0}

				if opacity < 0.5 {
					totalContribution := 0.0

					for _, ld := range lightData {
						toLight := voxel.WorldCoord{
							X: ld.pos.X - worldPos.X,
							Y: ld.pos.Y - worldPos.Y,
							Z: ld.pos.Z - worldPos.Z,
						}

						distance := math.Sqrt(toLight.X*toLight.X + toLight.Y*toLight.Y + toLight.Z*toLight.Z)
						if distance <= 0 || distance >= ld.radius {
							continue
						}

						toLightDir := voxel.WorldCoord{
							X: toLight.X / distance,
							Y: toLight.Y / distance,
							Z: toLight.Z / distance,
						}

						factor := 1.0

						if ld.typ == "spot" {
							spotFactor := voxel.CalculateSpotlightFactor(
								voxel.WorldCoord{X: -ld.dir.X, Y: -ld.dir.Y, Z: -ld.dir.Z},
								toLightDir,
								ld.angle,
							)
							if spotFactor <= 0 {
								continue
							}
							factor *= spotFactor
						}

						attenuation := voxel.CalculateLightAttenuation(distance, ld.radius)
						contribution := attenuation * factor

						noise := 0.8 + randGen.Float64()*0.4
						irradiance.R += ld.color.R * ld.inten * contribution * noise
						irradiance.G += ld.color.G * ld.inten * contribution * noise
						irradiance.B += ld.color.B * ld.inten * contribution * noise

						direction.X += toLightDir.X * contribution
						direction.Y += toLightDir.Y * contribution
						direction.Z += toLightDir.Z * contribution
						totalContribution += contribution
					}

					if totalContribution > 0 {
						direction.X /= totalContribution
						direction.Y /= totalContribution
						direction.Z /= totalContribution
					}
				}

				irradianceJSON, _ := json.Marshal(irradiance)
				directionJSON, _ := json.Marshal(direction)

				voxelData = append(voxelData, models.VoxelData{
					ID:         uuid.New(),
					VoxelGridID: uuid.Nil,
					X:          x,
					Y:          y,
					Z:          z,
					Irradiance: datatypes.JSON(irradianceJSON),
					Direction:  datatypes.JSON(directionJSON),
					Opacity:    opacity,
					Valid:      true,
					UpdatedAt:  time.Now(),
				})

				processed++
				progress := int(float64(processed) / float64(totalVoxels) * 95)

				if progress > lastProgress && progress%5 == 0 {
					lastProgress = progress
					_ = w.bakeRepo.UpdateProgress(w.task.ID, progress, TaskStatusRunning)
					w.notifier.BroadcastBakeProgress(w.task.SceneID, progress, TaskStatusRunning)
				}
			}
		}
	}

	return &BakeResult{VoxelData: voxelData}, nil
}

func (w *BakeWorker) processAdvanced(scene *models.Scene, lights []models.Light, objects []models.DynamicObject) (*BakeResult, error) {
	gridSizeX := w.task.GridSizeX
	gridSizeY := w.task.GridSizeY
	gridSizeZ := w.task.GridSizeZ
	resolution := w.task.Resolution
	totalVoxels := gridSizeX * gridSizeY * gridSizeZ
	raysPerVoxel := w.task.RaysPerVoxel
	rayBounces := w.task.RayBounces

	origin := w.parseVector3(scene.BoundsMin)

	voxelDataMap := make(map[voxel.VoxelCoord]*models.VoxelData, totalVoxels)
	voxelData := make([]models.VoxelData, 0, totalVoxels)
	processed := 0
	lastProgress := 0

	directions := voxel.GenerateHemisphereDirections(raysPerVoxel)

	lightData := make([]struct {
		pos    voxel.WorldCoord
		dir    voxel.WorldCoord
		color  *models.Color
		typ    string
		inten  float64
		radius float64
		angle  float64
	}, len(lights))

	for i, light := range lights {
		lightData[i] = struct {
			pos    voxel.WorldCoord
			dir    voxel.WorldCoord
			color  *models.Color
			typ    string
			inten  float64
			radius float64
			angle  float64
		}{
			pos:    w.parseVector3(light.Position),
			dir:    w.parseVector3(light.Direction),
			color:  w.parseColor(light.Color),
			typ:    light.Type,
			inten:  light.Intensity,
			radius: light.Radius,
			angle:  light.SpotAngle,
		}
	}

	for z := 0; z < gridSizeZ; z++ {
		for y := 0; y < gridSizeY; y++ {
			for x := 0; x < gridSizeX; x++ {
				select {
				case <-w.cancelChan:
					return nil, errors.New("task cancelled")
				default:
				}

				worldPos := voxel.VoxelToWorld(voxel.VoxelCoord{X: x, Y: y, Z: z}, origin, resolution)

				opacity := voxel.ComputeVoxelOpacity(objects, worldPos, resolution)

				totalIrradiance := &models.Color{R: 0, G: 0, B: 0}
				totalDirection := &models.Vector3{X: 0, Y: 0, Z: 0}
				totalWeight := 0.0

				if opacity < 0.5 {
					for _, dir := range directions {
						ray := voxel.Ray{
							Origin:    worldPos,
							Direction: dir,
						}

						bounceIrradiance := w.traceRay(ray, objects, lightData, rayBounces)

						totalIrradiance.R += bounceIrradiance.R
						totalIrradiance.G += bounceIrradiance.G
						totalIrradiance.B += bounceIrradiance.B

						totalDirection.X += dir.X
						totalDirection.Y += dir.Y
						totalDirection.Z += dir.Z
						totalWeight += 1.0
					}

					if totalWeight > 0 {
						totalIrradiance.R /= totalWeight
						totalIrradiance.G /= totalWeight
						totalIrradiance.B /= totalWeight
						totalDirection.X /= totalWeight
						totalDirection.Y /= totalWeight
						totalDirection.Z /= totalWeight
					}
				}

				irradianceJSON, _ := json.Marshal(totalIrradiance)
				directionJSON, _ := json.Marshal(totalDirection)

				vd := models.VoxelData{
					ID:         uuid.New(),
					VoxelGridID: uuid.Nil,
					X:          x,
					Y:          y,
					Z:          z,
					Irradiance: datatypes.JSON(irradianceJSON),
					Direction:  datatypes.JSON(directionJSON),
					Opacity:    opacity,
					Valid:      true,
					UpdatedAt:  time.Now(),
				}

				voxelData = append(voxelData, vd)
				voxelDataMap[voxel.VoxelCoord{X: x, Y: y, Z: z}] = &voxelData[len(voxelData)-1]

				processed++
				progress := int(float64(processed) / float64(totalVoxels) * 95)

				if progress > lastProgress && progress%5 == 0 {
					lastProgress = progress
					_ = w.bakeRepo.UpdateProgress(w.task.ID, progress, TaskStatusRunning)
					w.notifier.BroadcastBakeProgress(w.task.SceneID, progress, TaskStatusRunning)
				}
			}
		}
	}

	return &BakeResult{VoxelData: voxelData}, nil
}

func (w *BakeWorker) traceRay(ray voxel.Ray, objects []models.DynamicObject, lightData []struct {
	pos    voxel.WorldCoord
	dir    voxel.WorldCoord
	color  *models.Color
	typ    string
	inten  float64
	radius float64
	angle  float64
}, bounces int) *models.Color {
	result := &models.Color{R: 0, G: 0, B: 0}
	hit, dist := voxel.CheckRayIntersection(ray, objects, 100.0)

	if hit {
		hitPoint := voxel.WorldCoord{
			X: ray.Origin.X + ray.Direction.X*dist,
			Y: ray.Origin.Y + ray.Direction.Y*dist,
			Z: ray.Origin.Z + ray.Direction.Z*dist,
		}

		for _, ld := range lightData {
			toLight := voxel.WorldCoord{
				X: ld.pos.X - hitPoint.X,
				Y: ld.pos.Y - hitPoint.Y,
				Z: ld.pos.Z - hitPoint.Z,
			}

			distance := math.Sqrt(toLight.X*toLight.X + toLight.Y*toLight.Y + toLight.Z*toLight.Z)
			if distance <= 0 || distance >= ld.radius {
				continue
			}

			toLightDir := voxel.WorldCoord{
				X: toLight.X / distance,
				Y: toLight.Y / distance,
				Z: toLight.Z / distance,
			}

			shadowRay := voxel.Ray{
				Origin:    hitPoint,
				Direction: toLightDir,
			}
			shadowHit, _ := voxel.CheckRayIntersection(shadowRay, objects, distance-0.01)
			if shadowHit {
				continue
			}

			factor := 1.0
			if ld.typ == "spot" {
				spotFactor := voxel.CalculateSpotlightFactor(
					voxel.WorldCoord{X: -ld.dir.X, Y: -ld.dir.Y, Z: -ld.dir.Z},
					toLightDir,
					ld.angle,
				)
				if spotFactor <= 0 {
					continue
				}
				factor *= spotFactor
			}

			attenuation := voxel.CalculateLightAttenuation(distance, ld.radius)
			contribution := attenuation * factor

			result.R += ld.color.R * ld.inten * contribution
			result.G += ld.color.G * ld.inten * contribution
			result.B += ld.color.B * ld.inten * contribution
		}

		if bounces > 0 {
			normal := voxel.WorldCoord{X: 0, Y: 1, Z: 0}
			reflectDir := voxel.WorldCoord{
				X: ray.Direction.X - 2*voxelDot(ray.Direction, normal)*normal.X,
				Y: ray.Direction.Y - 2*voxelDot(ray.Direction, normal)*normal.Y,
				Z: ray.Direction.Z - 2*voxelDot(ray.Direction, normal)*normal.Z,
			}

			reflectRay := voxel.Ray{
				Origin:    hitPoint,
				Direction: reflectDir,
			}

			bounceColor := w.traceRay(reflectRay, objects, lightData, bounces-1)
			result.R += bounceColor.R * 0.3
			result.G += bounceColor.G * 0.3
			result.B += bounceColor.B * 0.3
		}
	}

	return result
}

func (w *BakeWorker) parseVector3(data datatypes.JSON) voxel.WorldCoord {
	var vec models.Vector3
	if err := json.Unmarshal(data, &vec); err != nil {
		return voxel.WorldCoord{X: 0, Y: 0, Z: 0}
	}
	return voxel.WorldCoord{X: vec.X, Y: vec.Y, Z: vec.Z}
}

func (w *BakeWorker) parseColor(data datatypes.JSON) *models.Color {
	var color models.Color
	if err := json.Unmarshal(data, &color); err != nil {
		return &models.Color{R: 1, G: 1, B: 1}
	}
	return &color
}

func voxelDot(a, b voxel.WorldCoord) float64 {
	return a.X*b.X + a.Y*b.Y + a.Z*b.Z
}

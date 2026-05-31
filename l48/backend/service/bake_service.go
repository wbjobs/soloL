package service

import (
	"errors"
	"sync"
	"vct-gi-system/models"
	"vct-gi-system/repository"
	"vct-gi-system/worker"

	"github.com/google/uuid"
)

type BakeProgressNotifier interface {
	BroadcastBakeProgress(sceneID uuid.UUID, progress int, status string)
}

type SceneBroadcaster interface {
	BroadcastToScene(sceneID uuid.UUID, msg interface{})
}

const (
	MaxConcurrentBakes = 2
	TaskStatusPending   = worker.TaskStatusPending
	TaskStatusRunning   = worker.TaskStatusRunning
	TaskStatusCompleted = worker.TaskStatusCompleted
	TaskStatusFailed    = worker.TaskStatusFailed
	TaskStatusCancelled = worker.TaskStatusCancelled
)

type BakeService struct {
	bakeRepo      *repository.BakeRepository
	sceneRepo     *repository.SceneRepository
	voxelRepo     *repository.VoxelRepository
	notifier      BakeProgressNotifier
	taskQueue     chan *models.BakeTask
	runningTasks  map[uuid.UUID]bool
	cancelSignals map[uuid.UUID]chan struct{}
	mu            sync.RWMutex
	workerCount   int
}

var (
	bakeServiceInstance *BakeService
	bakeServiceOnce     sync.Once
)

func NewBakeService(notifier BakeProgressNotifier) *BakeService {
	bakeServiceOnce.Do(func() {
		bakeServiceInstance = &BakeService{
			bakeRepo:      repository.NewBakeRepository(),
			sceneRepo:     repository.NewSceneRepository(),
			voxelRepo:     repository.NewVoxelRepository(),
			notifier:      notifier,
			taskQueue:     make(chan *models.BakeTask, 100),
			runningTasks:  make(map[uuid.UUID]bool),
			cancelSignals: make(map[uuid.UUID]chan struct{}),
			workerCount:   MaxConcurrentBakes,
		}
		bakeServiceInstance.startWorkers()
	})
	return bakeServiceInstance
}

func GetBakeService() *BakeService {
	return bakeServiceInstance
}

func (s *BakeService) startWorkers() {
	for i := 0; i < s.workerCount; i++ {
		go s.worker()
	}
}

func (s *BakeService) worker() {
	for task := range s.taskQueue {
		s.processTask(task)
	}
}

func (s *BakeService) processTask(task *models.BakeTask) {
	s.mu.Lock()
	if task.Status == TaskStatusCancelled {
		s.mu.Unlock()
		return
	}
	s.runningTasks[task.ID] = true
	cancelChan := make(chan struct{})
	s.cancelSignals[task.ID] = cancelChan
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.runningTasks, task.ID)
		delete(s.cancelSignals, task.ID)
		s.mu.Unlock()
	}()

	if err := s.bakeRepo.UpdateProgress(task.ID, 0, TaskStatusRunning); err != nil {
		return
	}
	s.notifier.BroadcastBakeProgress(task.SceneID, 0, TaskStatusRunning)

	bakeWorker := worker.NewBakeWorker(task, s.notifier, cancelChan)
	result, err := bakeWorker.Process()

	if err != nil {
		_ = s.bakeRepo.SetError(task.ID, err.Error())
		s.notifier.BroadcastBakeProgress(task.SceneID, task.Progress, TaskStatusFailed)
		return
	}

	gridID, err := s.saveBakeResult(task, result)
	if err != nil {
		_ = s.bakeRepo.SetError(task.ID, err.Error())
		s.notifier.BroadcastBakeProgress(task.SceneID, task.Progress, TaskStatusFailed)
		return
	}

	_ = s.bakeRepo.UpdateProgress(task.ID, 100, TaskStatusCompleted)
	task, _ = s.bakeRepo.GetByID(task.ID)
	task.VoxelGrid.ID = gridID
	s.notifier.BroadcastBakeProgress(task.SceneID, 100, TaskStatusCompleted)
}

func (s *BakeService) saveBakeResult(task *models.BakeTask, result *worker.BakeResult) (uuid.UUID, error) {
	scene, err := s.sceneRepo.GetByID(task.SceneID)
	if err != nil {
		return uuid.Nil, err
	}

	grid := &models.VoxelGrid{
		SceneID:    task.SceneID,
		BakeTaskID: &task.ID,
		Name:       "Bake_" + task.ID.String()[:8],
		GridSizeX:  task.GridSizeX,
		GridSizeY:  task.GridSizeY,
		GridSizeZ:  task.GridSizeZ,
		Resolution: task.Resolution,
		Origin:     scene.BoundsMin,
		IsActive:   true,
	}

	if err := s.voxelRepo.CreateGrid(grid); err != nil {
		return uuid.Nil, err
	}

	if err := s.voxelRepo.SetActiveGrid(task.SceneID, grid.ID); err != nil {
		return grid.ID, err
	}

	if err := s.voxelRepo.BatchCreateVoxelData(result.VoxelData); err != nil {
		return grid.ID, err
	}

	return grid.ID, nil
}

func (s *BakeService) CreateTask(sceneID, userID uuid.UUID, params map[string]interface{}) (*models.BakeTask, error) {
	owned, err := s.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		return nil, errors.New("access denied")
	}

	scene, err := s.sceneRepo.GetByID(sceneID)
	if err != nil {
		return nil, errors.New("scene not found")
	}

	gridSizeX := 32
	gridSizeY := 32
	gridSizeZ := 32
	resolution := scene.VoxelResolution
	rayBounces := 3
	raysPerVoxel := 64

	if v, ok := params["grid_size_x"].(float64); ok {
		gridSizeX = int(v)
	}
	if v, ok := params["grid_size_y"].(float64); ok {
		gridSizeY = int(v)
	}
	if v, ok := params["grid_size_z"].(float64); ok {
		gridSizeZ = int(v)
	}
	if v, ok := params["resolution"].(float64); ok {
		resolution = v
	}
	if v, ok := params["ray_bounces"].(float64); ok {
		rayBounces = int(v)
	}
	if v, ok := params["rays_per_voxel"].(float64); ok {
		raysPerVoxel = int(v)
	}

	task := &models.BakeTask{
		SceneID:      sceneID,
		UserID:       userID,
		Status:       TaskStatusPending,
		Progress:     0,
		GridSizeX:    gridSizeX,
		GridSizeY:    gridSizeY,
		GridSizeZ:    gridSizeZ,
		Resolution:   resolution,
		RayBounces:   rayBounces,
		RaysPerVoxel: raysPerVoxel,
	}

	if err := s.bakeRepo.Create(task); err != nil {
		return nil, err
	}

	activeCount, _ := s.bakeRepo.GetActiveTaskCount()
	if int(activeCount) <= MaxConcurrentBakes {
		s.taskQueue <- task
	}

	return task, nil
}

func (s *BakeService) GetTask(taskID, userID uuid.UUID) (*models.BakeTask, error) {
	owned, err := s.bakeRepo.OwnedByUser(taskID, userID)
	if err != nil || !owned {
		return nil, errors.New("access denied")
	}

	return s.bakeRepo.GetByID(taskID)
}

func (s *BakeService) ListTasks(sceneID, userID uuid.UUID) ([]models.BakeTask, error) {
	owned, err := s.sceneRepo.OwnedByUser(sceneID, userID)
	if err != nil || !owned {
		return nil, errors.New("access denied")
	}

	return s.bakeRepo.GetBySceneID(sceneID)
}

func (s *BakeService) CancelTask(taskID, userID uuid.UUID) error {
	owned, err := s.bakeRepo.OwnedByUser(taskID, userID)
	if err != nil || !owned {
		return errors.New("access denied")
	}

	task, err := s.bakeRepo.GetByID(taskID)
	if err != nil {
		return errors.New("task not found")
	}

	if task.Status == TaskStatusCompleted || task.Status == TaskStatusFailed || task.Status == TaskStatusCancelled {
		return errors.New("cannot cancel task in current state")
	}

	s.mu.Lock()
	if cancelChan, exists := s.cancelSignals[taskID]; exists {
		close(cancelChan)
	}
	s.mu.Unlock()

	return s.bakeRepo.Cancel(taskID)
}

func (s *BakeService) GetTaskProgress(taskID, userID uuid.UUID) (int, string, error) {
	owned, err := s.bakeRepo.OwnedByUser(taskID, userID)
	if err != nil || !owned {
		return 0, "", errors.New("access denied")
	}

	task, err := s.bakeRepo.GetByID(taskID)
	if err != nil {
		return 0, "", errors.New("task not found")
	}

	return task.Progress, task.Status, nil
}

func (s *BakeService) GetTaskResult(taskID, userID uuid.UUID) (*models.VoxelGrid, error) {
	owned, err := s.bakeRepo.OwnedByUser(taskID, userID)
	if err != nil || !owned {
		return nil, errors.New("access denied")
	}

	task, err := s.bakeRepo.GetByID(taskID)
	if err != nil {
		return nil, errors.New("task not found")
	}

	if task.Status != TaskStatusCompleted {
		return nil, errors.New("task not completed")
	}

	if task.VoxelGrid == nil {
		return nil, errors.New("no result available")
	}

	return task.VoxelGrid, nil
}

func (s *BakeService) EnqueuePendingTasks() {
	pendingTasks, err := s.bakeRepo.GetPendingTasks(MaxConcurrentBakes)
	if err != nil {
		return
	}

	for _, task := range pendingTasks {
		taskCopy := task
		s.taskQueue <- &taskCopy
	}
}

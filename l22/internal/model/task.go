package model

import "time"

type Task struct {
	ID          int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	Name        string    `json:"name" gorm:"size:255;not null"`
	Description string    `json:"description" gorm:"size:1024"`
	Payload     string    `json:"payload" gorm:"type:text"`
	Status      string    `json:"status" gorm:"size:50;not null;default:'pending'"`
	Priority    int       `json:"priority" gorm:"default:0"`
	UserID      int64     `json:"user_id" gorm:"not null;index"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (Task) TableName() string {
	return "tasks"
}

type TaskDependency struct {
	ID             int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	TaskID         int64 `json:"task_id" gorm:"not null;index"`
	DependsOnID    int64 `json:"depends_on_id" gorm:"not null;index"`
}

func (TaskDependency) TableName() string {
	return "task_dependencies"
}

type SubmitTaskRequest struct {
	Name         string `json:"name" binding:"required"`
	Description  string `json:"description"`
	Payload      string `json:"payload" binding:"required"`
	Priority     int    `json:"priority"`
	Dependencies []int64 `json:"dependencies"`
}

type QueryTaskRequest struct {
	TaskID int64 `uri:"task_id" binding:"required"`
}

type CancelTaskRequest struct {
	TaskID int64 `uri:"task_id" binding:"required"`
}

type TaskResponse struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Payload     string `json:"payload"`
	Status      string `json:"status"`
	Priority    int    `json:"priority"`
	UserID      int64  `json:"user_id"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type PreemptionLog struct {
	ID              int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	PreemptedTaskID int64     `json:"preempted_task_id" gorm:"not null;index"`
	NewTaskID       int64     `json:"new_task_id" gorm:"not null;index"`
	Strategy        string    `json:"strategy" gorm:"size:50;not null"`
	Reason          string    `json:"reason" gorm:"size:512"`
	LoadPercent     float64   `json:"load_percent"`
	CreatedAt       time.Time `json:"created_at"`
}

func (PreemptionLog) TableName() string {
	return "preemption_logs"
}

type APIResponse struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

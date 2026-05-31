package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type Vector3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type Color struct {
	R float64 `json:"r"`
	G float64 `json:"g"`
	B float64 `json:"b"`
}

type User struct {
	ID        uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Username  string         `gorm:"type:varchar(50);uniqueIndex;not null" json:"username"`
	Email     string         `gorm:"type:varchar(100);uniqueIndex;not null" json:"email"`
	Password  string         `gorm:"type:varchar(255);not null" json:"-"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

type Scene struct {
	ID              uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name            string         `gorm:"type:varchar(100);not null" json:"name"`
	Description     string         `gorm:"type:text" json:"description"`
	UserID          uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	BoundsMin       datatypes.JSON `gorm:"type:jsonb" json:"bounds_min"`
	BoundsMax       datatypes.JSON `gorm:"type:jsonb" json:"bounds_max"`
	VoxelResolution float64        `gorm:"type:float8;not null;default:1.0" json:"voxel_resolution"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`
	Lights          []Light        `gorm:"foreignKey:SceneID" json:"lights,omitempty"`
	VoxelGrids      []VoxelGrid    `gorm:"foreignKey:SceneID" json:"voxel_grids,omitempty"`
	DynamicObjects  []DynamicObject `gorm:"foreignKey:SceneID" json:"dynamic_objects,omitempty"`
}

type Light struct {
	ID         uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SceneID    uuid.UUID      `gorm:"type:uuid;not null;index" json:"scene_id"`
	Name       string         `gorm:"type:varchar(100);not null" json:"name"`
	Type       string         `gorm:"type:varchar(20);not null" json:"type"`
	Position   datatypes.JSON `gorm:"type:jsonb" json:"position"`
	Direction  datatypes.JSON `gorm:"type:jsonb" json:"direction"`
	Color      datatypes.JSON `gorm:"type:jsonb" json:"color"`
	Intensity  float64        `gorm:"type:float8;not null;default:1.0" json:"intensity"`
	Radius     float64        `gorm:"type:float8;default:1.0" json:"radius"`
	SpotAngle  float64        `gorm:"type:float8;default:45.0" json:"spot_angle"`
	Enabled    bool           `gorm:"default:true" json:"enabled"`
	CastShadow bool           `gorm:"default:true" json:"cast_shadow"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`
}

type BakeTask struct {
	ID          uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SceneID     uuid.UUID      `gorm:"type:uuid;not null;index" json:"scene_id"`
	UserID      uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	Status      string         `gorm:"type:varchar(20);not null;default:pending" json:"status"`
	Progress    int            `gorm:"default:0" json:"progress"`
	GridSizeX   int            `gorm:"not null" json:"grid_size_x"`
	GridSizeY   int            `gorm:"not null" json:"grid_size_y"`
	GridSizeZ   int            `gorm:"not null" json:"grid_size_z"`
	Resolution  float64        `gorm:"type:float8;not null" json:"resolution"`
	RayBounces  int            `gorm:"default:3" json:"ray_bounces"`
	RaysPerVoxel int           `gorm:"default:64" json:"rays_per_voxel"`
	StartedAt   *time.Time     `json:"started_at"`
	CompletedAt *time.Time     `json:"completed_at"`
	ErrorMsg    string         `gorm:"type:text" json:"error_msg"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	VoxelGrid   *VoxelGrid     `gorm:"foreignKey:BakeTaskID" json:"voxel_grid,omitempty"`
}

type VoxelGrid struct {
	ID         uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SceneID    uuid.UUID      `gorm:"type:uuid;not null;index" json:"scene_id"`
	BakeTaskID *uuid.UUID     `gorm:"type:uuid;index" json:"bake_task_id"`
	Name       string         `gorm:"type:varchar(100);not null" json:"name"`
	GridSizeX  int            `gorm:"not null" json:"grid_size_x"`
	GridSizeY  int            `gorm:"not null" json:"grid_size_y"`
	GridSizeZ  int            `gorm:"not null" json:"grid_size_z"`
	Resolution float64        `gorm:"type:float8;not null" json:"resolution"`
	Origin     datatypes.JSON `gorm:"type:jsonb" json:"origin"`
	IsActive   bool           `gorm:"default:true" json:"is_active"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`
	VoxelData  []VoxelData    `gorm:"foreignKey:VoxelGridID" json:"voxel_data,omitempty"`
}

type VoxelData struct {
	ID          uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	VoxelGridID uuid.UUID      `gorm:"type:uuid;not null;index" json:"voxel_grid_id"`
	X           int            `gorm:"not null;index:idx_voxel_coord" json:"x"`
	Y           int            `gorm:"not null;index:idx_voxel_coord" json:"y"`
	Z           int            `gorm:"not null;index:idx_voxel_coord" json:"z"`
	Irradiance  datatypes.JSON `gorm:"type:jsonb" json:"irradiance"`
	Direction   datatypes.JSON `gorm:"type:jsonb" json:"direction"`
	Opacity     float64        `gorm:"type:float8;default:0.0" json:"opacity"`
	Valid       bool           `gorm:"default:false" json:"valid"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type DynamicObject struct {
	ID        uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SceneID   uuid.UUID      `gorm:"type:uuid;not null;index" json:"scene_id"`
	Name      string         `gorm:"type:varchar(100);not null" json:"name"`
	ObjectType string        `gorm:"type:varchar(50);not null" json:"object_type"`
	Position  datatypes.JSON `gorm:"type:jsonb" json:"position"`
	Rotation  datatypes.JSON `gorm:"type:jsonb" json:"rotation"`
	Scale     datatypes.JSON `gorm:"type:jsonb" json:"scale"`
	MeshData  datatypes.JSON `gorm:"type:jsonb" json:"mesh_data"`
	Material  datatypes.JSON `gorm:"type:jsonb" json:"material"`
	IsStatic  bool           `gorm:"default:false" json:"is_static"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (v *Vector3) ToJSON() datatypes.JSON {
	data, _ := json.Marshal(v)
	return datatypes.JSON(data)
}

func (c *Color) ToJSON() datatypes.JSON {
	data, _ := json.Marshal(c)
	return datatypes.JSON(data)
}

func NewVector3(x, y, z float64) *Vector3 {
	return &Vector3{X: x, Y: y, Z: z}
}

func NewColor(r, g, b float64) *Color {
	return &Color{R: r, G: g, B: b}
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type RegisterRequest struct {
	Username string `json:"username" binding:"required,min=3,max=50"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
}

type VoxelQuery struct {
	MinX int `form:"min_x" binding:"required"`
	MaxX int `form:"max_x" binding:"required,gtefield=MinX"`
	MinY int `form:"min_y" binding:"required"`
	MaxY int `form:"max_y" binding:"required,gtefield=MinY"`
	MinZ int `form:"min_z" binding:"required"`
	MaxZ int `form:"max_z" binding:"required,gtefield=MinZ"`
}

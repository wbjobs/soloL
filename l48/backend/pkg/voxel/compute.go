package voxel

import (
	"encoding/json"
	"math"
	"vct-gi-system/models"
)

type VoxelCoord struct {
	X int
	Y int
	Z int
}

type WorldCoord struct {
	X float64
	Y float64
	Z float64
}

type Ray struct {
	Origin    WorldCoord
	Direction WorldCoord
}

func WorldToVoxel(world WorldCoord, origin WorldCoord, resolution float64) VoxelCoord {
	return VoxelCoord{
		X: int(math.Floor((world.X - origin.X) / resolution)),
		Y: int(math.Floor((world.Y - origin.Y) / resolution)),
		Z: int(math.Floor((world.Z - origin.Z) / resolution)),
	}
}

func VoxelToWorld(voxel VoxelCoord, origin WorldCoord, resolution float64) WorldCoord {
	return WorldCoord{
		X: origin.X + float64(voxel.X)*resolution + resolution/2,
		Y: origin.Y + float64(voxel.Y)*resolution + resolution/2,
		Z: origin.Z + float64(voxel.Z)*resolution + resolution/2,
	}
}

func VoxelToWorldCorner(voxel VoxelCoord, origin WorldCoord, resolution float64) WorldCoord {
	return WorldCoord{
		X: origin.X + float64(voxel.X)*resolution,
		Y: origin.Y + float64(voxel.Y)*resolution,
		Z: origin.Z + float64(voxel.Z)*resolution,
	}
}

func TrilinearInterpolate(pos WorldCoord, v000, v100, v010, v110, v001, v101, v011, v111 *models.VoxelData) *models.Color {
	origin := WorldCoord{X: 0, Y: 0, Z: 0}
	resolution := 1.0
	coord := WorldToVoxel(pos, origin, resolution)
	corner := VoxelToWorldCorner(coord, origin, resolution)

	x := (pos.X - corner.X) / resolution
	y := (pos.Y - corner.Y) / resolution
	z := (pos.Z - corner.Z) / resolution

	c000 := parseColor(v000)
	c100 := parseColor(v100)
	c010 := parseColor(v010)
	c110 := parseColor(v110)
	c001 := parseColor(v001)
	c101 := parseColor(v101)
	c011 := parseColor(v011)
	c111 := parseColor(v111)

	c00 := lerpColor(c000, c100, x)
	c10 := lerpColor(c010, c110, x)
	c01 := lerpColor(c001, c101, x)
	c11 := lerpColor(c011, c111, x)

	c0 := lerpColor(c00, c10, y)
	c1 := lerpColor(c01, c11, y)

	c := lerpColor(c0, c1, z)

	return c
}

func SampleIrradiance(grid *models.VoxelGrid, pos WorldCoord) *models.Color {
	if grid == nil {
		return &models.Color{R: 0, G: 0, B: 0}
	}

	origin := parseVector3(grid.Origin)
	resolution := grid.Resolution

	coord := WorldToVoxel(pos, origin, resolution)

	minX := 0
	maxX := grid.GridSizeX - 1
	minY := 0
	maxY := grid.GridSizeY - 1
	minZ := 0
	maxZ := grid.GridSizeZ - 1

	if coord.X < minX || coord.X > maxX || coord.Y < minY || coord.Y > maxY || coord.Z < minZ || coord.Z > maxZ {
		return &models.Color{R: 0, G: 0, B: 0}
	}

	clampedX := clamp(coord.X, minX, maxX)
	clampedY := clamp(coord.Y, minY, maxY)
	clampedZ := clamp(coord.Z, minZ, maxZ)

	voxelData := findVoxelData(grid, clampedX, clampedY, clampedZ)
	return parseColor(voxelData)
}

func SampleIrradianceTrilinear(grid *models.VoxelGrid, pos WorldCoord, voxelDataMap map[VoxelCoord]*models.VoxelData) *models.Color {
	if grid == nil {
		return &models.Color{R: 0, G: 0, B: 0}
	}

	origin := parseVector3(grid.Origin)
	resolution := grid.Resolution

	coord := WorldToVoxel(pos, origin, resolution)

	x0 := coord.X
	y0 := coord.Y
	z0 := coord.Z
	x1 := x0 + 1
	y1 := y0 + 1
	z1 := z0 + 1

	if x0 < 0 || x1 >= grid.GridSizeX || y0 < 0 || y1 >= grid.GridSizeY || z0 < 0 || z1 >= grid.GridSizeZ {
		return SampleIrradiance(grid, pos)
	}

	v000 := getVoxelData(voxelDataMap, x0, y0, z0)
	v100 := getVoxelData(voxelDataMap, x1, y0, z0)
	v010 := getVoxelData(voxelDataMap, x0, y1, z0)
	v110 := getVoxelData(voxelDataMap, x1, y1, z0)
	v001 := getVoxelData(voxelDataMap, x0, y0, z1)
	v101 := getVoxelData(voxelDataMap, x1, y0, z1)
	v011 := getVoxelData(voxelDataMap, x0, y1, z1)
	v111 := getVoxelData(voxelDataMap, x1, y1, z1)

	return TrilinearInterpolate(pos, v000, v100, v010, v110, v001, v101, v011, v111)
}

func GenerateHemisphereDirections(count int) []WorldCoord {
	directions := make([]WorldCoord, 0, count)
	phiStep := math.Pi * (3.0 - math.Sqrt(5.0))
	for i := 0; i < count; i++ {
		y := 1.0 - (float64(i) / float64(count-1))
		radius := math.Sqrt(1.0 - y*y)
		phi := phiStep * float64(i)
		x := math.Cos(phi) * radius
		z := math.Sin(phi) * radius
		directions = append(directions, WorldCoord{X: x, Y: y, Z: z})
	}
	return directions
}

func GenerateConeDirections(center WorldCoord, angle float64, count int) []WorldCoord {
	center = normalize(center)
	directions := make([]WorldCoord, 0, count)

	axis1 := perpendicular(center)
	axis1 = normalize(axis1)
	axis2 := cross(center, axis1)
	axis2 = normalize(axis2)

	for i := 0; i < count; i++ {
		u := float64(i) / float64(count)
		theta := u * angle
		phi := math.Pi * 2.0 * u * float64(count) / 3.0

		cosTheta := math.Cos(theta)
		sinTheta := math.Sin(theta)

		dir := WorldCoord{
			X: center.X*cosTheta + sinTheta*(axis1.X*math.Cos(phi) + axis2.X*math.Sin(phi)),
			Y: center.Y*cosTheta + sinTheta*(axis1.Y*math.Cos(phi) + axis2.Y*math.Sin(phi)),
			Z: center.Z*cosTheta + sinTheta*(axis1.Z*math.Cos(phi) + axis2.Z*math.Sin(phi)),
		}
		directions = append(directions, normalize(dir))
	}
	return directions
}

func ComputeVoxelOpacity(objects []models.DynamicObject, voxelPos WorldCoord, resolution float64) float64 {
	opacity := 0.0
	halfRes := resolution / 2.0

	for _, obj := range objects {
		if !obj.IsStatic {
			continue
		}

		objPos := parseVector3(obj.Position)
		objScale := parseVector3(obj.Scale)

		dx := math.Abs(voxelPos.X - objPos.X)
		dy := math.Abs(voxelPos.Y - objPos.Y)
		dz := math.Abs(voxelPos.Z - objPos.Z)

		extentX := objScale.X/2.0 + halfRes
		extentY := objScale.Y/2.0 + halfRes
		extentZ := objScale.Z/2.0 + halfRes

		if dx < extentX && dy < extentY && dz < extentZ {
			overlapX := 1.0 - dx/extentX
			overlapY := 1.0 - dy/extentY
			overlapZ := 1.0 - dz/extentZ
			overlap := overlapX * overlapY * overlapZ
			opacity = math.Max(opacity, overlap)
		}
	}

	return math.Min(opacity, 1.0)
}

func CheckRayIntersection(ray Ray, objects []models.DynamicObject, maxDist float64) (bool, float64) {
	minDist := maxDist
	hit := false

	for _, obj := range objects {
		if !obj.IsStatic {
			continue
		}

		objPos := parseVector3(obj.Position)
		objScale := parseVector3(obj.Scale)

		localRayOrigin := WorldCoord{
			X: ray.Origin.X - objPos.X,
			Y: ray.Origin.Y - objPos.Y,
			Z: ray.Origin.Z - objPos.Z,
		}

		halfScale := WorldCoord{
			X: objScale.X / 2.0,
			Y: objScale.Y / 2.0,
			Z: objScale.Z / 2.0,
		}

		tmin, tmax := 0.0, maxDist

		for i := 0; i < 3; i++ {
			ro := getCoord(localRayOrigin, i)
			rd := getCoord(ray.Direction, i)
			hs := getCoord(halfScale, i)

			if math.Abs(rd) < 1e-8 {
				if ro < -hs || ro > hs {
					return hit, minDist
				}
			} else {
				t1 := (-hs - ro) / rd
				t2 := (hs - ro) / rd
				if t1 > t2 {
					t1, t2 = t2, t1
				}
				tmin = math.Max(tmin, t1)
				tmax = math.Min(tmax, t2)
				if tmin > tmax {
					return hit, minDist
				}
			}
		}

		if tmin > 0 && tmin < minDist {
			minDist = tmin
			hit = true
		}
	}

	return hit, minDist
}

func CalculateLightAttenuation(distance float64, radius float64) float64 {
	if distance >= radius {
		return 0.0
	}
	attenuation := 1.0 / (1.0 + 0.09*distance + 0.032*distance*distance)
	falloff := 1.0 - (distance*distance*distance)/(radius*radius*radius)
	falloff = falloff * falloff
	return attenuation * falloff
}

func CalculateSpotlightFactor(lightDir, toLight WorldCoord, spotAngle float64) float64 {
	cosAngle := dot(lightDir, toLight)
	cosHalfAngle := math.Cos(spotAngle * math.Pi / 180.0 / 2.0)
	if cosAngle < cosHalfAngle {
		return 0.0
	}
	epsilon := cosHalfAngle - 1.0
	factor := math.Max(0.0, (cosAngle - 1.0) / epsilon)
	return factor * factor
}

func lerp(a, b, t float64) float64 {
	return a + (b-a)*t
}

func lerpColor(c1, c2 *models.Color, t float64) *models.Color {
	return &models.Color{
		R: lerp(c1.R, c2.R, t),
		G: lerp(c1.G, c2.G, t),
		B: lerp(c1.B, c2.B, t),
	}
}

func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func normalize(v WorldCoord) WorldCoord {
	length := math.Sqrt(v.X*v.X + v.Y*v.Y + v.Z*v.Z)
	if length < 1e-8 {
		return WorldCoord{X: 0, Y: 0, Z: 0}
	}
	return WorldCoord{
		X: v.X / length,
		Y: v.Y / length,
		Z: v.Z / length,
	}
}

func dot(a, b WorldCoord) float64 {
	return a.X*b.X + a.Y*b.Y + a.Z*b.Z
}

func cross(a, b WorldCoord) WorldCoord {
	return WorldCoord{
		X: a.Y*b.Z - a.Z*b.Y,
		Y: a.Z*b.X - a.X*b.Z,
		Z: a.X*b.Y - a.Y*b.X,
	}
}

func perpendicular(v WorldCoord) WorldCoord {
	if math.Abs(v.X) < math.Abs(v.Y) {
		return WorldCoord{X: 0, Y: v.Z, Z: -v.Y}
	}
	return WorldCoord{X: -v.Z, Y: 0, Z: v.X}
}

func getCoord(v WorldCoord, i int) float64 {
	switch i {
	case 0:
		return v.X
	case 1:
		return v.Y
	case 2:
		return v.Z
	default:
		return 0
	}
}

func parseColor(data *models.VoxelData) *models.Color {
	if data == nil || len(data.Irradiance) == 0 {
		return &models.Color{R: 0, G: 0, B: 0}
	}
	var color models.Color
	if err := json.Unmarshal(data.Irradiance, &color); err != nil {
		return &models.Color{R: 0, G: 0, B: 0}
	}
	return &color
}

func parseVector3(data interface{}) WorldCoord {
	switch v := data.(type) {
	case []byte:
		var vec models.Vector3
		if err := json.Unmarshal(v, &vec); err != nil {
			return WorldCoord{X: 0, Y: 0, Z: 0}
		}
		return WorldCoord{X: vec.X, Y: vec.Y, Z: vec.Z}
	default:
		return WorldCoord{X: 0, Y: 0, Z: 0}
	}
}

func getVoxelData(dataMap map[VoxelCoord]*models.VoxelData, x, y, z int) *models.VoxelData {
	if dataMap == nil {
		return nil
	}
	coord := VoxelCoord{X: x, Y: y, Z: z}
	return dataMap[coord]
}

func findVoxelData(grid *models.VoxelGrid, x, y, z int) *models.VoxelData {
	for i := range grid.VoxelData {
		if grid.VoxelData[i].X == x && grid.VoxelData[i].Y == y && grid.VoxelData[i].Z == z {
			return &grid.VoxelData[i]
		}
	}
	return nil
}

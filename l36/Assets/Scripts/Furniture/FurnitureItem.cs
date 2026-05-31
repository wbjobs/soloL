using System.Collections.Generic;
using UnityEngine;
using LiDARFurniturePlacer.Core;

namespace LiDARFurniturePlacer.Furniture
{
    public class FurnitureItem : MonoBehaviour
    {
        [SerializeField] private FurnitureData data;
        [SerializeField] private Renderer[] renderers;
        [SerializeField] private Collider furnitureCollider;

        public FurnitureData Data
        {
            get => data;
            set => data = value;
        }

        public Vector3 ActualSize => data.ActualSize;
        public Vector3 OriginalSize => data.OriginalSize;

        public void Initialize(FurnitureData furnitureData, Mesh mesh, Material material)
        {
            data = furnitureData;

            GameObject meshObject = new GameObject("Mesh");
            meshObject.transform.SetParent(transform, false);

            MeshFilter meshFilter = meshObject.AddComponent<MeshFilter>();
            MeshRenderer meshRenderer = meshObject.AddComponent<MeshRenderer>();

            meshFilter.mesh = mesh;
            meshRenderer.material = material;

            renderers = new[] { meshRenderer };

            MeshCollider meshCollider = meshObject.AddComponent<MeshCollider>();
            meshCollider.convex = true;
            meshCollider.isTrigger = false;
            furnitureCollider = meshCollider;

            transform.position = data.Position;
            transform.rotation = data.Rotation;
            transform.localScale = data.Scale;

            UpdateBounds();
        }

        public void SetDataFromTransform()
        {
            data.Position = transform.position;
            data.Rotation = transform.rotation;
            data.Scale = transform.localScale;
        }

        public void UpdateScale(Vector3 newScale, Vector3 newActualSize)
        {
            data.Scale = newScale;
            data.ActualSize = newActualSize;
            transform.localScale = newScale;
            UpdateBounds();
        }

        private void UpdateBounds()
        {
            if (furnitureCollider != null)
            {
                Bounds bounds = furnitureCollider.bounds;
                data.ActualSize = bounds.size;
            }
        }

        public Bounds GetBounds()
        {
            if (furnitureCollider != null)
            {
                return furnitureCollider.bounds;
            }
            return new Bounds(transform.position, data.ActualSize);
        }

        public void SetHighlight(bool highlight)
        {
            foreach (var renderer in renderers)
            {
                if (renderer != null)
                {
                    renderer.material.SetFloat("_Emission", highlight ? 0.5f : 0f);
                }
            }
        }

        public void SetRenderMode(RenderMode mode)
        {
            foreach (var renderer in renderers)
            {
                if (renderer != null)
                {
                    if (mode == RenderMode.Wireframe)
                    {
                        renderer.material.SetFloat("_Wireframe", 1f);
                    }
                    else
                    {
                        renderer.material.SetFloat("_Wireframe", 0f);
                    }
                }
            }
        }

        public bool CheckCollision(Vector3 position, Quaternion rotation, Vector3 scale, LayerMask collisionLayer)
        {
            Bounds bounds = GetBounds();
            Vector3 halfExtents = Vector3.Scale(bounds.extents, scale);

            Collider[] colliders = Physics.OverlapBox(position, halfExtents, rotation, collisionLayer);

            foreach (Collider collider in colliders)
            {
                if (collider != furnitureCollider && !collider.isTrigger)
                {
                    return true;
                }
            }

            return false;
        }
    }
}

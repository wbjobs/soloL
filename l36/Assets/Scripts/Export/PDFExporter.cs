using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;
using LiDARFurniturePlacer.Core;
using LiDARFurniturePlacer.PointCloud;

namespace LiDARFurniturePlacer.Export
{
    public class PDFExporter
    {
        private class PDFObject
        {
            public int Id;
            public string Content;
            public int Position;
        }

        private List<PDFObject> objects;
        private MemoryStream stream;
        private BinaryWriter writer;
        private int objectId;

        public bool ExportFurnitureLayout(string outputPath,
                                          List<FurnitureData> furnitureList,
                                          Bounds roomBounds,
                                          string title = "Furniture Layout")
        {
            try
            {
                objects = new List<PDFObject>();
                stream = new MemoryStream();
                writer = new BinaryWriter(stream);
                objectId = 1;

                WriteHeader();

                int catalogId = CreateCatalog();
                int pagesId = CreatePages();
                int pageId = CreatePage(pagesId);
                int contentId = CreatePageContent(furnitureList, roomBounds, title);
                int resourcesId = CreateResources();

                UpdatePage(pageId, contentId, resourcesId);
                UpdatePages(pagesId, pageId);
                UpdateCatalog(catalogId, pagesId);

                int xrefPosition = WriteCrossReferenceTable();
                WriteTrailer(catalogId, xrefPosition);

                byte[] pdfData = stream.ToArray();
                File.WriteAllBytes(outputPath, pdfData);

                Debug.Log($"PDF exported successfully to: {outputPath}");
                return true;
            }
            catch (Exception e)
            {
                Debug.LogError($"Failed to export PDF: {e.Message}");
                return false;
            }
            finally
            {
                writer?.Close();
                stream?.Close();
            }
        }

        private void WriteHeader()
        {
            byte[] header = Encoding.ASCII.GetBytes("%PDF-1.4\n%âãÏÓ\n");
            writer.Write(header);
        }

        private int CreateCatalog()
        {
            int id = objectId++;
            string content = "<< /Type /Catalog /Pages 0 R >>";
            AddObject(id, content);
            return id;
        }

        private int CreatePages()
        {
            int id = objectId++;
            string content = "<< /Type /Pages /Count 1 /Kids [] >>";
            AddObject(id, content);
            return id;
        }

        private int CreatePage(int pagesId)
        {
            int id = objectId++;
            string content = $"<< /Type /Page /Parent {pagesId} 0 R /MediaBox [0 0 842 595] >>";
            AddObject(id, content);
            return id;
        }

        private int CreateResources()
        {
            int id = objectId++;
            string content = @"<< /Font 
    << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
       /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
    >>
>>";
            AddObject(id, content);
            return id;
        }

        private int CreatePageContent(List<FurnitureData> furnitureList, Bounds roomBounds, string title)
        {
            int id = objectId++;

            StringBuilder contentBuilder = new StringBuilder();
            contentBuilder.AppendLine("BT");
            contentBuilder.AppendLine("/F2 24 Tf");
            contentBuilder.AppendLine("50 540 Td");
            contentBuilder.AppendLine($"({EscapeString(title)}) Tj");
            contentBuilder.AppendLine("ET");

            contentBuilder.AppendLine("BT");
            contentBuilder.AppendLine("/F1 12 Tf");
            contentBuilder.AppendLine("50 520 Td");
            contentBuilder.AppendLine($"({EscapeString($"Export Date: {DateTime.Now:yyyy-MM-dd HH:mm:ss}")}) Tj");
            contentBuilder.AppendLine("ET");

            contentBuilder.AppendLine("BT");
            contentBuilder.AppendLine("50 505 Td");
            contentBuilder.AppendLine($"({EscapeString($"Room Dimensions: {roomBounds.size.x:F2}m x {roomBounds.size.y:F2}m x {roomBounds.size.z:F2}m")}) Tj");
            contentBuilder.AppendLine("ET");

            contentBuilder.AppendLine("BT");
            contentBuilder.AppendLine("/F2 16 Tf");
            contentBuilder.AppendLine("50 470 Td");
            contentBuilder.AppendLine("(Floor Plan) Tj");
            contentBuilder.AppendLine("ET");

            DrawFloorPlan(contentBuilder, furnitureList, roomBounds);

            contentBuilder.AppendLine("BT");
            contentBuilder.AppendLine("/F2 16 Tf");
            contentBuilder.AppendLine("50 250 Td");
            contentBuilder.AppendLine("(Furniture List) Tj");
            contentBuilder.AppendLine("ET");

            DrawFurnitureList(contentBuilder, furnitureList);

            string content = $"<< /Length {contentBuilder.Length} >>\nstream\n{contentBuilder}endstream";
            AddObject(id, content);

            return id;
        }

        private void DrawFloorPlan(StringBuilder builder, List<FurnitureData> furnitureList, Bounds roomBounds)
        {
            float planX = 50;
            float planY = 270;
            float planWidth = 200;
            float planHeight = 200;

            float scaleX = planWidth / Mathf.Max(roomBounds.size.x, 0.01f);
            float scaleZ = planHeight / Mathf.Max(roomBounds.size.z, 0.01f);
            float scale = Mathf.Min(scaleX, scaleZ);

            float centerX = planX + planWidth / 2;
            float centerY = planY + planHeight / 2;

            builder.AppendLine("0.5 w");
            builder.AppendLine("0 0 0 RG");
            builder.AppendLine($"{planX} {planY} {planWidth} {planHeight} re");
            builder.AppendLine("S");

            builder.AppendLine("0.5 w");
            builder.AppendLine("0.7 0.7 0.7 RG");

            float minX = centerX - roomBounds.size.x * scale / 2;
            float minY = centerY - roomBounds.size.z * scale / 2;
            float roomW = roomBounds.size.x * scale;
            float roomH = roomBounds.size.z * scale;

            builder.AppendLine($"{minX} {minY} {roomW} {roomH} re");
            builder.AppendLine("B");

            builder.AppendLine("1 w");
            builder.AppendLine("0.2 0.5 0.8 RG");

            foreach (var furniture in furnitureList)
            {
                float fx = centerX + furniture.Position.x * scale;
                float fy = centerY + furniture.Position.z * scale;
                float fw = Mathf.Max(furniture.ActualSize.x * scale, 5);
                float fh = Mathf.Max(furniture.ActualSize.z * scale, 5);

                builder.AppendLine("q");
                builder.AppendLine($"{fx} {fy} {fw} {fh} re");
                builder.AppendLine("B");

                float angle = furniture.Rotation.eulerAngles.y * Mathf.Deg2Rad;
                float cos = Mathf.Cos(angle);
                float sin = Mathf.Sin(angle);

                builder.AppendLine($"{cos} {sin} {-sin} {cos} {fx} {fy} cm");
                builder.AppendLine("0 0 m");
                builder.AppendLine($"{fw} 0 l");
                builder.AppendLine("S");
                builder.AppendLine("Q");
            }

            builder.AppendLine("BT");
            builder.AppendLine("/F1 10 Tf");
            for (int i = 0; i < furnitureList.Count; i++)
            {
                var furniture = furnitureList[i];
                float fx = centerX + furniture.Position.x * scale;
                float fy = centerY + furniture.Position.z * scale;

                builder.AppendLine($"{fx} {fy} Td");
                builder.AppendLine($"({i + 1}) Tj");
            }
            builder.AppendLine("ET");
        }

        private void DrawFurnitureList(StringBuilder builder, List<FurnitureData> furnitureList)
        {
            float startY = 230;
            float lineHeight = 15;
            float colX1 = 50;
            float colX2 = 80;
            float colX3 = 200;
            float colX4 = 350;
            float colX5 = 450;

            builder.AppendLine("BT");
            builder.AppendLine("/F2 12 Tf");
            builder.AppendLine($"{colX1} {startY} Td");
            builder.AppendLine("(#) Tj");
            builder.AppendLine($"{colX2} {startY} Td");
            builder.AppendLine("(Name) Tj");
            builder.AppendLine($"{colX3} {startY} Td");
            builder.AppendLine("(Position) Tj");
            builder.AppendLine($"{colX4} {startY} Td");
            builder.AppendLine("(Rotation) Tj");
            builder.AppendLine($"{colX5} {startY} Td");
            builder.AppendLine("(Size) Tj");
            builder.AppendLine("ET");

            builder.AppendLine("0.5 w");
            builder.AppendLine("0 0 0 RG");
            builder.AppendLine($"{colX1} {startY - 5} {500} 0 m S");

            builder.AppendLine("BT");
            builder.AppendLine("/F1 10 Tf");

            for (int i = 0; i < furnitureList.Count; i++)
            {
                var furniture = furnitureList[i];
                float y = startY - lineHeight * (i + 2);

                if (y < 30) break;

                builder.AppendLine($"{colX1} {y} Td");
                builder.AppendLine($"({i + 1}) Tj");

                builder.AppendLine($"{colX2} {y} Td");
                builder.AppendLine($"({EscapeString(furniture.Name)}) Tj");

                builder.AppendLine($"{colX3} {y} Td");
                string posStr = $"({furniture.Position.x:F2}, {furniture.Position.y:F2}, {furniture.Position.z:F2})";
                builder.AppendLine(posStr);

                builder.AppendLine($"{colX4} {y} Td");
                builder.AppendLine($"({furniture.Rotation.eulerAngles.y:F1}°) Tj");

                builder.AppendLine($"{colX5} {y} Td");
                string sizeStr = $"({furniture.ActualSize.x:F2}m x {furniture.ActualSize.y:F2}m x {furniture.ActualSize.z:F2}m)";
                builder.AppendLine(sizeStr);
            }
            builder.AppendLine("ET");

            builder.AppendLine("BT");
            builder.AppendLine("/F1 10 Tf");
            builder.AppendLine("50 50 Td");
            builder.AppendLine($"({EscapeString($"Total Furniture: {furnitureList.Count} items")}) Tj");
            builder.AppendLine("ET");
        }

        private void UpdatePage(int pageId, int contentId, int resourcesId)
        {
            objects[pageId - 1].Content = $"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents {contentId} 0 R /Resources {resourcesId} 0 R >>";
        }

        private void UpdatePages(int pagesId, int pageId)
        {
            objects[pagesId - 1].Content = $"<< /Type /Pages /Count 1 /Kids [{pageId} 0 R] >>";
        }

        private void UpdateCatalog(int catalogId, int pagesId)
        {
            objects[catalogId - 1].Content = $"<< /Type /Catalog /Pages {pagesId} 0 R >>";
        }

        private void AddObject(int id, string content)
        {
            PDFObject obj = new PDFObject
            {
                Id = id,
                Content = content,
                Position = (int)stream.Position
            };

            byte[] data = Encoding.ASCII.GetBytes($"{id} 0 obj\n{content}\nendobj\n");
            writer.Write(data);

            objects.Add(obj);
        }

        private int WriteCrossReferenceTable()
        {
            int position = (int)stream.Position;

            StringBuilder builder = new StringBuilder();
            builder.AppendLine("xref");
            builder.AppendLine($"0 {objects.Count + 1}");
            builder.AppendLine("0000000000 65535 f ");

            foreach (var obj in objects)
            {
                builder.AppendLine($"{obj.Position:D10} 00000 n ");
            }

            byte[] data = Encoding.ASCII.GetBytes(builder.ToString());
            writer.Write(data);

            return position;
        }

        private void WriteTrailer(int catalogId, int xrefPosition)
        {
            StringBuilder builder = new StringBuilder();
            builder.AppendLine($"trailer\n<< /Size {objects.Count + 1} /Root {catalogId} 0 R >>");
            builder.AppendLine("startxref");
            builder.AppendLine(xrefPosition.ToString());
            builder.AppendLine("%%EOF");

            byte[] data = Encoding.ASCII.GetBytes(builder.ToString());
            writer.Write(data);
        }

        private string EscapeString(string input)
        {
            if (string.IsNullOrEmpty(input))
                return string.Empty;

            StringBuilder builder = new StringBuilder();
            foreach (char c in input)
            {
                switch (c)
                {
                    case '\\':
                        builder.Append("\\\\");
                        break;
                    case '(':
                        builder.Append("\\(");
                        break;
                    case ')':
                        builder.Append("\\)");
                        break;
                    default:
                        if (c < 32 || c > 126)
                        {
                            builder.AppendFormat("\\{0:D3}", (int)c);
                        }
                        else
                        {
                            builder.Append(c);
                        }
                        break;
                }
            }
            return builder.ToString();
        }

        public bool ExportScreenshotWithLayout(string outputPath, Texture2D screenshot, List<FurnitureData> furnitureList)
        {
            try
            {
                objects = new List<PDFObject>();
                stream = new MemoryStream();
                writer = new BinaryWriter(stream);
                objectId = 1;

                WriteHeader();

                int catalogId = CreateCatalog();
                int pagesId = CreatePages();
                int pageId = CreatePage(pagesId);

                int imageId = 0;
                if (screenshot != null)
                {
                    imageId = CreateImage(screenshot);
                }

                int contentId = CreateScreenshotPageContent(furnitureList, screenshot != null);
                int resourcesId = CreateScreenshotResources(imageId);

                UpdateScreenshotPage(pageId, contentId, resourcesId);
                UpdatePages(pagesId, pageId);
                UpdateCatalog(catalogId, pagesId);

                int xrefPosition = WriteCrossReferenceTable();
                WriteTrailer(catalogId, xrefPosition);

                byte[] pdfData = stream.ToArray();
                File.WriteAllBytes(outputPath, pdfData);

                Debug.Log($"PDF with screenshot exported successfully to: {outputPath}");
                return true;
            }
            catch (Exception e)
            {
                Debug.LogError($"Failed to export PDF with screenshot: {e.Message}");
                return false;
            }
            finally
            {
                writer?.Close();
                stream?.Close();
            }
        }

        private int CreateImage(Texture2D texture)
        {
            int id = objectId++;

            byte[] imageData = texture.EncodeToJPG(90);

            string content = $"<< /Type /XObject /Subtype /Image /Width {texture.width} /Height {texture.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {imageData.Length} >>";
            AddObject(id, content);

            PDFObject obj = objects[id - 1];
            long headerPos = stream.Position;

            writer.Write(Encoding.ASCII.GetBytes("stream\n"));
            writer.Write(imageData);
            writer.Write(Encoding.ASCII.GetBytes("\nendstream\nendobj\n"));

            return id;
        }

        private int CreateScreenshotResources(int imageId)
        {
            int id = objectId++;
            string content = $@"<< /Font 
    << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
       /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
    >>
    /XObject << /Im1 {imageId} 0 R >>
>>";
            AddObject(id, content);
            return id;
        }

        private int CreateScreenshotPageContent(List<FurnitureData> furnitureList, bool hasImage)
        {
            int id = objectId++;

            StringBuilder contentBuilder = new StringBuilder();

            contentBuilder.AppendLine("BT");
            contentBuilder.AppendLine("/F2 20 Tf");
            contentBuilder.AppendLine("50 800 Td");
            contentBuilder.AppendLine("(Furniture Layout Report) Tj");
            contentBuilder.AppendLine("ET");

            if (hasImage)
            {
                contentBuilder.AppendLine("q");
                contentBuilder.AppendLine("500 0 0 375 50 400 cm");
                contentBuilder.AppendLine("/Im1 Do");
                contentBuilder.AppendLine("Q");
            }

            contentBuilder.AppendLine("BT");
            contentBuilder.AppendLine("/F2 14 Tf");
            contentBuilder.AppendLine("50 380 Td");
            contentBuilder.AppendLine("(Furniture Items) Tj");
            contentBuilder.AppendLine("ET");

            contentBuilder.AppendLine("BT");
            contentBuilder.AppendLine("/F1 10 Tf");
            float y = 360;
            for (int i = 0; i < furnitureList.Count; i++)
            {
                var furniture = furnitureList[i];
                contentBuilder.AppendLine($"50 {y} Td");
                contentBuilder.AppendLine($"({EscapeString($"{i + 1}. {furniture.Name} - Position: ({furniture.Position.x:F2}, {furniture.Position.y:F2}, {furniture.Position.z:F2})")}) Tj");
                y -= 15;
            }
            contentBuilder.AppendLine("ET");

            contentBuilder.AppendLine("BT");
            contentBuilder.AppendLine("/F1 10 Tf");
            contentBuilder.AppendLine("50 50 Td");
            contentBuilder.AppendLine($"({EscapeString($"Generated: {DateTime.Now:yyyy-MM-dd HH:mm:ss}")}) Tj");
            contentBuilder.AppendLine("ET");

            string content = $"<< /Length {contentBuilder.Length} >>\nstream\n{contentBuilder}endstream";
            AddObject(id, content);

            return id;
        }

        private void UpdateScreenshotPage(int pageId, int contentId, int resourcesId)
        {
            objects[pageId - 1].Content = $"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 1190] /Contents {contentId} 0 R /Resources {resourcesId} 0 R >>";
        }
    }
}

package api

import (
	"citybuilder/internal/websocket"
	"net/http"

	"github.com/gorilla/mux"
)

func SetupRouter(handler *Handler, wsHub *websocket.Hub) *mux.Router {
	r := mux.NewRouter()

	r.Use(CORS)

	api := r.PathPrefix("/api").Subrouter()

	api.HandleFunc("/grid", handler.GetGrid).Methods("GET")
	api.HandleFunc("/tile", handler.GetTile).Methods("GET")
	api.HandleFunc("/grid/size", handler.GetGridSize).Methods("GET")

	api.HandleFunc("/building", handler.PlaceBuilding).Methods("POST")
	api.HandleFunc("/building/demolish", handler.DemolishBuilding).Methods("POST")
	api.HandleFunc("/buildings", handler.GetBuildings).Methods("GET")

	api.HandleFunc("/resources", handler.GetResources).Methods("GET")

	api.HandleFunc("/time", handler.GetTime).Methods("GET")

	api.HandleFunc("/events", handler.GetEvents).Methods("GET")

	api.HandleFunc("/pathfind", handler.FindPath).Methods("GET")

	api.HandleFunc("/trade/order", handler.CreateOrder).Methods("POST")
	api.HandleFunc("/trade/order/cancel", handler.CancelOrder).Methods("POST")
	api.HandleFunc("/trade/orderbook", handler.GetOrderBook).Methods("GET")
	api.HandleFunc("/trade/chart", handler.GetPriceChart).Methods("GET")
	api.HandleFunc("/trade/orders", handler.GetMyOrders).Methods("GET")

	r.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		wsHub.HandleWebSocket(w, r)
	})

	fs := http.FileServer(http.Dir("./static"))
	r.PathPrefix("/").Handler(fs)

	return r
}

func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

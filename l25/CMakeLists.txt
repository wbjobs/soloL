cmake_minimum_required(VERSION 3.16)
project(RTSGameAI LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(WIN32)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} /wd4996")
endif()

find_package(Lua53 QUIET)
if(NOT Lua53_FOUND)
    find_package(lua REQUIRED)
endif()

find_package(RecastNavigation QUIET)

find_package(SQLite3 QUIET)
if(NOT SQLITE3_FOUND)
    set(SQLITE3_INCLUDE_DIR "")
    set(SQLITE3_LIBRARY "")
endif()

file(GLOB_RECURSE RTSGameAI_SOURCES
    "Source/RTSGameAI/Private/*.cpp"
    "Source/Main.cpp"
)

add_executable(${PROJECT_NAME} ${RTSGameAI_SOURCES})

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/Source/RTSGameAI/Public
    ${CMAKE_CURRENT_SOURCE_DIR}/ThirdParty
    ${SQLITE3_INCLUDE_DIR}
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    lua
)

if(TARGET recast)
    target_link_libraries(${PROJECT_NAME} PRIVATE recast detour)
endif()

if(SQLITE3_FOUND AND SQLITE3_LIBRARY)
    target_link_libraries(${PROJECT_NAME} PRIVATE ${SQLITE3_LIBRARY})
    target_compile_definitions(${PROJECT_NAME} PRIVATE HAVE_SQLITE)
endif()

if(WIN32)
    target_link_libraries(${PROJECT_NAME} PRIVATE ws2_32)
endif()

if(MSVC)
    target_compile_options(${PROJECT_NAME} PRIVATE /bigobj)
endif()


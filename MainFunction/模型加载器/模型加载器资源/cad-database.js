/**
 * CAD数据库管理模块 - 使用IndexedDB
 * 用于存储项目、模型、材质等数据
 */

const CAD_DB_NAME = 'CandyCAD';
const CAD_DB_VERSION = 1;

// 数据库存储结构
const CAD_STORES = {
    projects: '项目存储',
    models: '模型存储',
    materials: '材质存储',
    settings: '设置存储',
    history: '历史记录'
};

class CADDatabase {
    constructor() {
        this.db = null;
        this.isReady = false;
    }

    /**
     * 初始化数据库
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(CAD_DB_NAME, CAD_DB_VERSION);

            request.onerror = (event) => {
                console.error('数据库打开失败:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.isReady = true;
                console.log('数据库连接成功');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // 创建项目存储
                if (!db.objectStoreNames.contains('projects')) {
                    const projectStore = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
                    projectStore.createIndex('name', 'name', { unique: false });
                    projectStore.createIndex('createdAt', 'createdAt', { unique: false });
                    projectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                }

                // 创建模型存储
                if (!db.objectStoreNames.contains('models')) {
                    const modelStore = db.createObjectStore('models', { keyPath: 'id', autoIncrement: true });
                    modelStore.createIndex('projectId', 'projectId', { unique: false });
                    modelStore.createIndex('name', 'name', { unique: false });
                    modelStore.createIndex('type', 'type', { unique: false });
                }

                // 创建材质存储
                if (!db.objectStoreNames.contains('materials')) {
                    const materialStore = db.createObjectStore('materials', { keyPath: 'id', autoIncrement: true });
                    materialStore.createIndex('name', 'name', { unique: false });
                    materialStore.createIndex('type', 'type', { unique: false });
                }

                // 创建设置存储
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                // 创建历史记录存储
                if (!db.objectStoreNames.contains('history')) {
                    const historyStore = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
                    historyStore.createIndex('projectId', 'projectId', { unique: false });
                    historyStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                console.log('数据库结构创建完成');
            };
        });
    }

    /**
     * 获取事务
     */
    getTransaction(storeName, mode = 'readonly') {
        if (!this.db) {
            throw new Error('数据库未初始化');
        }
        return this.db.transaction(storeName, mode);
    }

    /**
     * 获取存储对象
     */
    getStore(storeName, mode = 'readonly') {
        return this.getTransaction(storeName, mode).objectStore(storeName);
    }

    // ==================== 项目操作 ====================

    /**
     * 创建新项目
     */
    async createProject(project) {
        const store = this.getStore('projects', 'readwrite');
        const data = {
            name: project.name || '未命名项目',
            description: project.description || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            settings: project.settings || {
                gridSize: 20,
                gridVisible: true,
                snapEnabled: true,
                unit: 'mm'
            },
            camera: project.camera || {
                position: [5, 5, 5],
                target: [0, 0, 0],
                fov: 60
            },
            metadata: project.metadata || {}
        };

        return new Promise((resolve, reject) => {
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取所有项目
     */
    async getAllProjects() {
        const store = this.getStore('projects');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取单个项目
     */
    async getProject(id) {
        const store = this.getStore('projects');
        return new Promise((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 更新项目
     */
    async updateProject(id, updates) {
        const store = this.getStore('projects', 'readwrite');
        return new Promise((resolve, reject) => {
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const project = getRequest.result;
                if (!project) {
                    reject(new Error('项目不存在'));
                    return;
                }
                Object.assign(project, updates, { updatedAt: Date.now() });
                const putRequest = store.put(project);
                putRequest.onsuccess = () => resolve(project);
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    /**
     * 删除项目
     */
    async deleteProject(id) {
        const store = this.getStore('projects', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.delete(id);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== 模型操作 ====================

    /**
     * 创建模型
     */
    async createModel(model) {
        const store = this.getStore('models', 'readwrite');
        const data = {
            projectId: model.projectId,
            name: model.name || '未命名模型',
            type: model.type || 'mesh',
            geometry: model.geometry || null,
            transform: model.transform || {
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1]
            },
            material: model.material || {
                color: '#3b82f6',
                opacity: 1,
                wireframe: false
            },
            visible: true,
            locked: false,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        return new Promise((resolve, reject) => {
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取项目的所有模型
     */
    async getProjectModels(projectId) {
        const store = this.getStore('models');
        const index = store.index('projectId');
        return new Promise((resolve, reject) => {
            const request = index.getAll(projectId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取单个模型
     */
    async getModel(id) {
        const store = this.getStore('models');
        return new Promise((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 更新模型
     */
    async updateModel(id, updates) {
        const store = this.getStore('models', 'readwrite');
        return new Promise((resolve, reject) => {
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const model = getRequest.result;
                if (!model) {
                    reject(new Error('模型不存在'));
                    return;
                }
                Object.assign(model, updates, { updatedAt: Date.now() });
                const putRequest = store.put(model);
                putRequest.onsuccess = () => resolve(model);
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    /**
     * 删除模型
     */
    async deleteModel(id) {
        const store = this.getStore('models', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.delete(id);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== 材质操作 ====================

    /**
     * 创建材质
     */
    async createMaterial(material) {
        const store = this.getStore('materials', 'readwrite');
        const data = {
            name: material.name || '未命名材质',
            type: material.type || 'standard',
            color: material.color || '#3b82f6',
            opacity: material.opacity || 1,
            metalness: material.metalness || 0,
            roughness: material.roughness || 0.5,
            emissive: material.emissive || '#000000',
            wireframe: material.wireframe || false,
            doubleSided: material.doubleSided || false,
            textureMaps: material.textureMaps || {},
            createdAt: Date.now()
        };

        return new Promise((resolve, reject) => {
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取所有材质
     */
    async getAllMaterials() {
        const store = this.getStore('materials');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取材质
     */
    async getMaterial(id) {
        const store = this.getStore('materials');
        return new Promise((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 更新材质
     */
    async updateMaterial(id, updates) {
        const store = this.getStore('materials', 'readwrite');
        return new Promise((resolve, reject) => {
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const material = getRequest.result;
                if (!material) {
                    reject(new Error('材质不存在'));
                    return;
                }
                Object.assign(material, updates);
                const putRequest = store.put(material);
                putRequest.onsuccess = () => resolve(material);
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    /**
     * 删除材质
     */
    async deleteMaterial(id) {
        const store = this.getStore('materials', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.delete(id);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== 设置操作 ====================

    /**
     * 保存设置
     */
    async saveSetting(key, value) {
        const store = this.getStore('settings', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put({ key, value, updatedAt: Date.now() });
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取设置
     */
    async getSetting(key) {
        const store = this.getStore('settings');
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result?.value);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取所有设置
     */
    async getAllSettings() {
        const store = this.getStore('settings');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const settings = {};
                request.result.forEach(item => {
                    settings[item.key] = item.value;
                });
                resolve(settings);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== 历史记录操作 ====================

    /**
     * 添加历史记录
     */
    async addHistory(projectId, action, data) {
        const store = this.getStore('history', 'readwrite');
        const record = {
            projectId,
            action,
            data,
            timestamp: Date.now()
        };

        return new Promise((resolve, reject) => {
            const request = store.add(record);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取项目历史记录
     */
    async getProjectHistory(projectId, limit = 50) {
        const store = this.getStore('history');
        const index = store.index('projectId');
        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(projectId));
            const results = [];
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    results.push(cursor.value);
                    if (results.length < limit) {
                        cursor.continue();
                    } else {
                        resolve(results.reverse());
                    }
                } else {
                    resolve(results.reverse());
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 清除项目历史记录
     */
    async clearProjectHistory(projectId) {
        const store = this.getStore('history', 'readwrite');
        const index = store.index('projectId');
        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(projectId));
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve(true);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== 导入导出 ====================

    /**
     * 导出项目数据
     */
    async exportProject(projectId) {
        const project = await this.getProject(projectId);
        const models = await this.getProjectModels(projectId);
        const history = await this.getProjectHistory(projectId);

        return {
            version: CAD_DB_VERSION,
            exportedAt: Date.now(),
            project,
            models,
            history
        };
    }

    /**
     * 导入项目数据
     */
    async importProject(data) {
        // 创建项目
        const projectId = await this.createProject({
            name: data.project.name + ' (导入)',
            description: data.project.description,
            settings: data.project.settings,
            camera: data.project.camera
        });

        // 导入模型
        if (data.models && data.models.length > 0) {
            for (const model of data.models) {
                await this.createModel({
                    ...model,
                    projectId
                });
            }
        }

        return projectId;
    }

    /**
     * 清空所有数据
     */
    async clearAll() {
        const storeNames = ['projects', 'models', 'materials', 'settings', 'history'];
        const promises = storeNames.map(name => {
            return new Promise((resolve, reject) => {
                const store = this.getStore(name, 'readwrite');
                const request = store.clear();
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            });
        });
        return Promise.all(promises);
    }
}

// 创建全局实例
const cadDB = new CADDatabase();

// 导出
export { CADDatabase, cadDB, CAD_DB_NAME, CAD_DB_VERSION };
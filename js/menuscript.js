 document.addEventListener('DOMContentLoaded', function () {
            // 获取id为menu1的select下拉菜单元素
            var menu1 = document.getElementById('menu1');
            // 为其添加change事件监听器
            menu1.addEventListener('change', function () {
                window.location.href = menu1.value;
            });

            // 获取id为menu2的select下拉菜单元素
            var menu2 = document.getElementById('menu2');
            // 为其添加change事件监听器
            menu2.addEventListener('change', function () {
                window.location.href = menu2.value;
            });
        });
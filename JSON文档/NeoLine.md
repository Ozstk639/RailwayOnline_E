[
  {
    "LineID": "线路ID",      //<string>线路编号，命名方法待定，用于唯一索引
    "LineName":"线路名"      //<string>线路名，用于为页面Label提供文本信息，可与其他站台名重复(用于多站台车站)
    "bureau": "R",          //<string>路局代码
    "line": "1",            //<string>线路编号
    "direction":方向,         //<integer>线路的上下行方向(0,下行; 1,上行; 2, 无定义; 3, 显示用总线)   
    "labelL1":标识种类1,          //<integer>用于label根据数值判断使用label等级所用(1=xxx,2=xxx,3=xxx)
    "labelL2":标识种类2,          //<integer>同上，仅备用       
    "PLpoints": [                //组成该线的所有控制点,y值若无则默认为0，便于其他方式的数据导入
            [x,y,z],
            [x,y,z],
            [x,y,z],
            ...
        ],    
    "startplf":"起点站台" , //<string>起点站台ID
    "endplf":"终点站台" , //<string>终点站台ID
  },
]
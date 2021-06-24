const express = require("express")
const app = express()
const mysql = require("mysql2/promise")
const cors = require("cors")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const fs = require("fs")

const config = JSON.parse(fs.readFileSync("config.json").toString("utf-8")) 

app.use(express.json())
app.use(cors(config.cors.origin))

function jwtVerify(token) {
    return new Promise((resolve, reject) => {
        jwt.verify(token, config.privateKey, (err, decoded) => {
            if(err) reject(err)
            resolve(decoded)
        })
    })
}

// register
app.post('/member', async (req, res) => {
    try {
        const id = req.body.id
        const password = req.body.password
        const nickname = req.body.nickname
        if(!id || !password || !nickname) {
            throw new Error()
        }

        //hash password
        const saltRounds = 10
        const hash = await bcrypt.hash(password, saltRounds)
        
        const connection = await mysql.createConnection(config.dbConnect)
        const [rows, fields] = await connection.execute(
            "INSERT INTO member (id, password, nickname) VALUES (?, ?, ?);"
            , [id, hash, nickname]
        )

        res.json({ result: true })
    } catch(e) {
        res.status(400).json({ result: false })
    }
})

// login
app.post('/member/login', async (req, res) => {
    try {
        const id = req.body.id
        const password = req.body.password

        if(!id || !password) {
            throw new Error()
        }

        const connection = await mysql.createConnection(config.dbConnect)
        const [rows, fields] = await connection.execute(
            "SELECT id, password FROM member WHERE id = ?;", [id])

        const match = await bcrypt.compare(password, rows[0].password)
        
        if(id !== rows[0].id || !match) {
            throw new Error()
        }

        const token = await new Promise((resolve, reject) => {
            jwt.sign({ id }, config.privateKey, (err, token) => {
                if(err) reject(err)
                resolve(token)
            })
        }) 
        
        res.json({ result: true, token })
    } catch(e) {
        res.json({ result: false })
        console.error(e)
    }
})
// list
app.get('/list', async (req, res) => {
    try {
        const token = req.headers.token
        
        await jwtVerify(token)
        
        const pageNo = (req.query.pageNo - 1) * 10
        
        const connection = await mysql.createConnection(config.dbConnect)
        const [rows, fields] = await connection.execute(
            "SELECT title_no, title, member.nickname, board_text.datetime " +
            "FROM board_text LEFT JOIN member ON member.id = board_text.id " +
            `ORDER BY title_no DESC LIMIT ${pageNo}, 10;`)
        //get total number of titles to paginate
        const [rowsCnt, fieldsCnt] = await connection.execute(
            "SELECT COUNT(*) as maxTitleNo " +
            "FROM board_text;")
            
        res.json({ result: true, list: rows, maxTitleNo: rowsCnt[0].maxTitleNo })
    } catch(e) {
        res.json({ result: false })
        console.error(e)
    }
})  

// read text
app.get("/board/:titleNo", async (req, res) => {
    try {
        const titleNo = req.params.titleNo

        const connection = await mysql.createConnection(config.dbConnect)
        const [rows, fields] = await connection.execute(
            "SELECT member.nickname, title, contents, board_text.datetime " +
            "FROM board_text LEFT JOIN member ON member.id = board_text.id WHERE title_no = ?"
            , [titleNo])

        res.json({ result: true, read: rows })
    } catch(e) {
        res.json({ result: false })
    }
}) 

// write text
app.post("/board", async (req, res) => {
    try {
        const token = req.headers.token
        const decoded = await jwtVerify(token)

        const title = req.body.title
        const contents = req.body.contents

        if(!title || !contents) {
            throw new Error()
        }

        const connection = await mysql.createConnection(config.dbConnect)
        const [rows, fields] = await connection.execute(
            "INSERT INTO board_text (id, title, contents) VALUES (?, ?, ?);"
            , [decoded.id, title, contents])
     
        res.json({ result: true, titleNo: rows.insertId })
    } catch(e) {
        res.json({ result: false })
    }
}) 

// modify text
app.put("/board/:titleNo", async (req, res) => {
    try {
        const titleNo = req.params.titleNo
        const token = req.headers.token

        const title = req.body.title
        const contents = req.body.contents
        
        if(!title || !contents) {
            throw new Error()
        }

        const decoded = await jwtVerify(token)

        const connection = await mysql.createConnection(config.dbConnect)
        const [rowsVerify, fieldsVerify] = await connection.execute(
            "SELECT id FROM board_text WHERE title_no = ?;", [titleNo])

        if(rowsVerify[0].id !== decoded.id) {
            throw new Error()
        }

        const [rows, fields] = await connection.execute(
            "UPDATE board_text SET title = ?, contents = ? WHERE title_no = ?;"
            , [title, contents, titleNo])
                    
        res.json({ result: true, titleNo: rows.insertId })
    } catch(e) {
        res.json({ result: false })
    }
}) 

// delete text
app.delete("/board/:titleNo", async (req, res) => {
    try {
        const titleNo = req.params.titleNo
        const token = req.headers.token
        
        if(!titleNo || !token) {
            throw new Error()
        }

        const decoded = await jwtVerify(token)

        const connection = await mysql.createConnection(config.dbConnect)
        const [rowsVerify, fieldsVerify] = await connection.execute(
            "SELECT id FROM board_text WHERE title_no = ?;", [titleNo])

        if(rowsVerify[0].id !== decoded.id) {
            throw new Error()
        }

        const [rowsReply, fieldsReply] = await connection.execute(
            "DELETE FROM board_reply WHERE title_no = ?;"
            , [titleNo])
         
        const [rowsText, fieldsText] = await connection.execute(
            "DELETE FROM board_text WHERE title_no = ?;"
            , [titleNo])
            
        res.json({ result: true })
    } catch(e) {
        res.json({ result: false })
    }
}) 

//read reply
app.get("/board/:titleNo/reply", async (req, res) => {
    try {
        const titleNo = req.params.titleNo

        const connection = await mysql.createConnection(config.dbConnect)
        const [rows, fields] = await connection.execute(
            "SELECT reply_no, member.nickname, reply, board_reply.datetime " +
            "FROM board_reply LEFT JOIN member ON member.id = board_reply.id WHERE title_no = ?"
            , [titleNo])

        res.json({ result: true, reply: rows })
    } catch(e) {
        res.json({ result: false })
    }
}) 

// write reply
app.post("/board/:titleNo/reply", async (req, res) => {
    try {
        const decoded = await jwtVerify(req.headers.token)

        const titleNo = req.params.titleNo
        const reply = req.body.reply
        
        if(!reply) {
            throw new Error()
        }
        
        const connection = await mysql.createConnection(config.dbConnect)
        const [rows, fields] = await connection.execute(
            "INSERT INTO board_reply (id, reply, title_no) VALUES (?, ?, ?);"
            , [decoded.id, reply, titleNo])
            
        res.json({ result: true })
    } catch(e) {
        res.json({ result: false })
    }
})

// modify reply
app.put("/board/:titleNo/reply/:replyNo", async (req, res) => {
    try {
        const replyNo = req.params.replyNo
        const token = req.headers.token
        const reply = req.body.reply
        
        if(!reply) {
            throw new Error()
        }

        const decoded = await jwtVerify(token)
        
        const connection = await mysql.createConnection(config.dbConnect)
        const [rowsVerify, fieldsVerify] = await connection.execute(
            "SELECT id FROM board_reply WHERE reply_no = ?;", [replyNo])
        console.log(3)
        if(rowsVerify[0].id !== decoded.id) {
            throw new Error()
        }
        
        const [rows, fields] = await connection.execute(
            "UPDATE board_reply SET reply = ? WHERE reply_no = ?;"
            , [reply, replyNo])
       
        res.json({ result: true })
    } catch(e) {
        res.json({ result: false })
    }
}) 

// delete reply
app.delete("/board/:titleNo/reply/:replyNo", async (req, res) => {
    try {
        const titleNo = req.params.titleNo
        const replyNo = req.params.replyNo
        const token = req.headers.token
        
        if(!titleNo || !replyNo) {
            throw new Error()
        }

        const decoded = await jwtVerify(token)

        const connection = await mysql.createConnection(config.dbConnect)
        const [rowsVerify, fieldsVerify] = await connection.execute(
            "SELECT id FROM board_reply WHERE reply_no = ?;", [replyNo])
        
        if(rowsVerify[0].id !== decoded.id) {
            throw new Error()
        }
        
        const [rows, fields] = await connection.execute(
            "DELETE FROM board_reply WHERE reply_no = ?;"
            , [replyNo])
            
        res.json({ result: true })
    } catch(e) {
        res.json({ result: false })
        console.error(e)
    }
}) 
app.listen(3594)
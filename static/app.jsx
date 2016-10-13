var container = document.getElementById('content'),
config = {
  debug: true,
  defaultUrl: 'http://ya.ru\nhttp://google.com\nhttp://facebook.com\nhttp://mail.ru',
  urls: {
    site: 'http://truetug.info/',
    ws: container.getAttribute('data-ws'),
    task: '/api/task/',
  },
  taskBoxRefreshPeriodicity: 500,
  paginationNear: 3,
  scheduledMax: 5,
},
log = function(){
  if(config.debug && window.console !== undefined)
  console.log.apply(this, arguments);
},
sock = window.WebSocket === undefined && function(){
  // Weird experiment
  log('Websocket is not available');

  return {
    send: function(){}
  }}() || function(){
    var timeout = 500,
      maxTimeout = 30000,
      ws,
      listeners = {},
      connect = function(){
        ws = new WebSocket(config.urls.ws);
        ws.onopen = function(event){ log('connected', event) };
        ws.onclose = function(event){
          log('close', event, 'reconnect in', timeout);
          setTimeout(connect, timeout);
          timeout = Math.min(timeout * 2, maxTimeout);
        };
        ws.onerror = function(event){ log('error', event) };
        ws.onmessage = function(event){
          log('on message', event);

          var data = JSON.parse(event.data),
              channel = data.channel;

          if(channel && channel in listeners) {
            listeners[channel].map((cb) => cb(data.message))
          };
        };
      },
      send = function(data){
        log('Sending data', data, ws);

        if(ws){
          ws.send(JSON.stringify(data));
        }
        else {
          log('Websocket down, try resend in', timeout);
          setTimeout(this.send(), timeout);
        }
      },
      register = function(channel, cb){
        log('Subscribing', cb, 'for channel', channel);
        if(!listeners[channel]) listeners[channel] = [];
        listeners[channel].push(cb);
      };

  connect();
  return {
    send: send,
    register: register,
  }
}(),
now = new Date();

if(sock)
(function(){
  sock.register('configuration', function(data){
    log('Update config', data);
    config = Object.assign(config, data);
  })
})();

var Root = React.createClass({
  render: function(){
    return (
      <div>
        <TasksBox />
      </div>
    )
  }
}),
Paginator = React.createClass({
  render: function(){
    var first = Math.max(this.props.current - config.paginationNear, 0),
        last = Math.min(this.props.current + config.paginationNear, this.props.total - 1),
        pageList = [];

    pageList.push({
      number: Math.max(this.props.current - 1, 0),
      cls: 'pagination-previous',
      title: 'Previous page',
      display: 'Previous',
      isDisabled: this.props.current == 0
    });

    for(let i=first; i<=last; i++) {
      let display = i + 1;

      pageList.push({
        number: i,
        display: display,
        title: 'Page ' + display,
        isCurrent: i == this.props.current
      });
    };

    pageList.push({
      number: Math.min(this.props.current + 1, this.props.total - 1),
      cls: 'pagination-next',
      title: 'Next page',
      display: 'Next',
      isDisabled: this.props.current >= this.props.total - 1
    });

    return (
      <div className="b-pagination">
        <div className="row">
          <div className="small-12 column">
            <ul className="pagination text-center" role="navigation" aria-label="Pagination">
              {pageList.map((item, i) => {
                let itemCls = [item.cls, item.isDisabled && 'disabled', item.isCurrent && 'current'].map((cls) => cls || '').join(' ').trim();

                return (item.isCurrent || item.isDisabled) ? (
                  <li key={i} className={itemCls}>
                    <span className="show-for-sr">You are on page</span> {item.display}
                  </li>
                ) : (
                  <li key={i} className={itemCls}>
                    <a aria-label={item.title} onClick={this.props.handlePageChange.bind(null, item.number)}>{item.display}</a>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    )
  }
}),
TasksBox = React.createClass({
  getInitialState: function() {
    return {
      page: 0,
      url: config.defaultUrl,
      date: null,
      tasks: [],
      scheduled: 0,
    };
  },
  componentDidMount: function() {
    if(!sock) {
      this.loadDataFromServer();
      setInterval(this.loadDataFromServer, config.taskBoxRefreshPeriodicity);
    }
    else {
      sock.register('tasks', this.handleDataFromServer);
    }
  },
  loadDataFromServer: function() {
    var _this = this;

    axios.get(config.urls.task, {
      params: {page: this.state.page}
    })
      .then(function(response){
        _this.handleDataFromServer(response);
      })
      .catch(function(error) {
        console.log(error);
      });
  },
  handleDataFromServer: function(data) {
    this.setState({
      tasks: data.objects,
      paging: data.meta,
      scheduled: data.scheduled,
    })
  },
  handlePageChange: function(page, e) {
    e && e.preventDefault();
    this.setState({page: page});

    if(sock) {
      sock.send({
        action: 'list',
        page: page,
      })
    }
  },
  handleChangeUrl: function(e) {
    this.setState({url: e.target.value});
  },
  handleChangeDate: function(e) {
    this.setState({date: e.target.value});
  },
  handleAddTask: function(e) {
    e.preventDefault();

    this.state.url.split('\n').map(url => {
      url = url.trim();

      if(url)
      axios.post(config.urls.task, {
        url: url,
        date: this.state.date
      })
        .then(function(response) {
          log('Add task', response);
        })
        .catch(function(error) {
          console.log(error);
        });
    })

    this.setState({url: '', date: null});
  },
  handleRemoveTask: function(slug, e){
    e.preventDefault();
    var _this = this,
        url = config.urls.task + slug + '/';

    if(window.confirm('Are you really want to remove the task?'))
    axios.delete(url, {})
      .then(function(response) {
        log('Delete task', response);
        if(!_this.state.objects) {
          let page = Math.max(0, _this.state.page - 1);
          _this.handlePageChange(page);
        }
      })
      .catch(function(error) {
        console.log(error);
      });
  },
  render: function() {
    return (
      <div className="b-tasksbox">

        <div className="top-bar">
          <div className="top-bar-title">
            <strong>{config.name} <sup>v{config.version}</sup></strong>
          </div>
        </div>

        <TasksForm
          url={this.state.url}
          date={this.state.date}
          scheduled={this.state.scheduled}
          handleAddTask={this.handleAddTask}
          handleChangeUrl={this.handleChangeUrl}
          handleChangeDate={this.handleChangeDate} />

        <hr />

        <TasksList
          handleRemoveTask={this.handleRemoveTask}
          handlePageChange={this.handlePageChange}
          {...this.state} />

        <footer className="b-footer">
          <div className="row">
            <div className="column text-center">
              <small>© <a href={config.urls.site}>{config.author}</a>, {now.getFullYear()}</small>
            </div>
          </div>
        </footer>
      </div>
    );
  }
}),
TasksList = React.createClass({
  render: function() {
    return (
        <div className="b-taskslist">
          <div className="row">
          {this.props.tasks.map((task) => {
            var progressCls = ['progress', task.style].join(' '),
                progressStl = {width: task.progress + '%'},
                taskStl = (task.image) ? {
                  backgroundImage: 'url(' + task.image + ')',
                  backgroundPosition: 'top center',
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: 'contain',
                } : {},
                taskTitle = (task.progress == 100) ? task.url : task.url + ' (' + task.dl + ' kb)',
                taskScreenshotStl = {
                  backgroundImage: 'url(' + task.screenshot + ')',
                  backgroundPosition: 'top center',
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: 'cover',
                  width: '100%',
                  height: '200px',
                  overflow: 'hidden',
                  borderBottom: '1px dashed #CCC',
                },
                taskScreenshot = (task.screenshot) ? (
                  <div>
                    <p>Screenshot:</p>
                    <div style={taskScreenshotStl}></div>
                  </div>
                ) : '';

            return (
              <div key={task.slug} className="small-12 medium-12 large-4 column" style={taskStl}>
                <div className="media-object stack-for-small">
                  <div className="media-object-section main-section">
                    <h3>{task.title} <a className="alert button tiny" href="#" onClick={this.props.handleRemoveTask.bind(null, task.slug)}><i className="fi-x"></i></a></h3>
                    <p>URL: <a href={task.url}>{task.url}</a></p>
                    <p>Size: {task.dl} kb</p>
                    <p>Heading: {task.heading}</p>
                    <p>Message: {task.message}</p>
                    <p>Progress:</p>
                    <div className={progressCls}>
                      <div className="progress-meter" style={progressStl}></div>
                    </div>
                    {taskScreenshot}
                  </div>
                </div>
              </div>
            )
          })}
          </div>

          <Paginator
            {...this.props.paging}
            handlePageChange={this.props.handlePageChange} />
        </div>
    )
  }
}),
TasksForm = React.createClass({
  render: function(){
    let isDisabled = this.props.scheduled >= config.scheduledMax,
        buttonCls = ['success', 'button', isDisabled && 'disabled'].map((cls) => cls || '').join(' ').trim(),
        date = this.props.date || now.toISOString().slice(0, 16);

    return (
      <div className="b-taskform">
        <div className="row">
          <div className="small-12 columns">
            <form onSubmit={this.props.handleAddTask}>
              <label htmlFor="id_url">Parse following URLs: </label>
              <textarea
                id="id_url"
                rows="5"
                value={this.props.url}
                placeholder="Enter urls to parse"
                onChange={this.props.handleChangeUrl}></textarea>
              <label htmlFor="id_date">Schedule on: </label>
              <input
                id="id_date"
                type="datetime-local"
                min={date}
                onChange={this.props.handleChangeDate} />
              <button disabled={isDisabled} type="submit" className={buttonCls}>Add tasks</button>
            </form>
          </div>
        </div>
      </div>
    )
  }
});

ReactDOM.render(<TasksBox />, container);
